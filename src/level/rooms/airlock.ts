/** FAB ACCESS LOCK — x -2…2, z -26…-20, h 3.2. Decon lock: grated floor, nozzle arrays, beacons. */
import { rng } from '../builder';
import type { LevelBuild } from '../context';
import { floorSlab, hazardStrip, louvre, pipe, trench, valve } from '../kit';
import { beacon, ceilingSlab, wallFace } from '../structure';

const PI = Math.PI;

export function buildAirlock(L: LevelBuild) {
  const b = L.builder('airlock');
  const R = rng(606);
  const H = 3.2, Z0 = -25.8, Z1 = -20.2;
  L.room('airlock', 'FAB ACCESS LOCK', -2, 2, -26, -20, H);

  floorSlab(b, 'floor_plate', -2.4, -26, 2.4, -20, [[-1.3, -25.1, 1.3, -20.9]], 'metal');
  trench(b, -1.3, -25.1, 1.3, -20.9, 0.55, R, true);
  hazardStrip(b, -1.55, -25.1, -1.3, -20.9); hazardStrip(b, 1.3, -25.1, 1.55, -20.9);
  ceilingSlab(b, -2.4, -26, 2.4, -20, H);

  wallFace(b, { n: '-z', plane: Z1, from: -2, to: 2, h: H, t: 0.2, openings: [{ c: 0, w: 3.0, h: 2.8 }], seed: 41, trayY: 0, style: 'ribbed' });
  wallFace(b, { n: '+z', plane: Z0, from: -2, to: 2, h: H, t: 0.2, openings: [{ c: 0, w: 3.0, h: 2.8 }], seed: 42, trayY: 0, style: 'ribbed' });
  wallFace(b, { n: '+x', plane: -2, from: Z0, to: Z1, h: H, seed: 43, trayY: 0, style: 'ribbed', bay: 1.4, features: 0 });
  wallFace(b, { n: '-x', plane: 2, from: Z0, to: Z1, h: H, seed: 44, trayY: 0, style: 'ribbed', bay: 1.4, features: 0 });

  // ── decon hoops: pipe arches with nozzles at every pilaster ──
  const n = 4, step = (Z1 - Z0) / n;
  for (let i = 0; i <= n; i++) {
    const z = Z0 + i * step + (i === 0 ? 0.12 : i === n ? -0.12 : 0);
    b.detail(() => {
      pipe(b, 'chrome', [[-1.82, 0.3, z], [-1.82, H - 0.22, z], [1.82, H - 0.22, z], [1.82, 0.3, z]], 0.03, { flanges: false, elbow: 1.3 });
      for (let y = 0.6; y < 2.7; y += 0.42) for (const s of [-1, 1]) {
        b.cyl('brass', s * 1.76, y, z, 0.022, 0.08, 'x', 6);
        b.cyl('brass', s * 1.71, y, z, 0.03, 0.02, 'x', 8);
      }
      for (let x = -1.4; x <= 1.41; x += 0.56) { b.cyl('brass', x, H - 0.28, z, 0.022, 0.08, 'y', 6); b.cyl('brass', x, H - 0.33, z, 0.03, 0.02, 'y', 8); }
    });
  }
  // feed manifold along the ceiling + valves on the left wall
  pipe(b, 'steel_raw', [[-1.5, H - 0.12, Z0 + 0.1], [-1.5, H - 0.12, Z1 - 0.1]], 0.05, { every: 1.4 });
  pipe(b, 'copper', [[1.5, H - 0.12, Z0 + 0.1], [1.5, H - 0.12, Z1 - 0.1]], 0.04, { every: 1.4 });
  b.detail(() => {
    valve(b, -1.5, H - 0.12, -23, 'z', 0.05, 'y', -1);
    // big extraction fan grille in the ceiling
    b.cyl('painted_dark', 0, H - 0.03, -23, 0.62, 0.06, 'y', 20);
    b.torus('trim_steel', 0, H - 0.07, -23, 0.6, 0.035, 'y', 20);
    for (let i = 0; i < 6; i++) b.rbox('trim_steel', 0, H - 0.08, -23, 1.16, 0.02, 0.05, 0, (i * PI) / 6, 0);
    b.cyl('trim_steel', 0, H - 0.09, -23, 0.12, 0.05, 'y', 10);
    // control box + status
    b.at(2, 0, -21.6, -PI / 2, () => {
      b.box('painted_dark', 0, 1.4, 0.07, 0.4, 0.55, 0.1);
      b.box('emissive_amber', -0.1, 1.55, 0.125, 0.06, 0.06, 0.01).box('emissive_red', 0.05, 1.55, 0.125, 0.06, 0.06, 0.01);
      b.box('steel_raw', 0, 1.3, 0.13, 0.2, 0.12, 0.02);
      louvre(b, -0.5, 0.35, 0.5, 0.95, 0.06, 0.04);
    });
    b.at(-2, 0, -24.4, PI / 2, () => louvre(b, -0.5, 0.35, 0.5, 0.95, 0.06, 0.04));
  });

  // ── lights: one hard overhead key through the fan grille, cold strips, an amber beacon turning ──
  L.spot('airlock', 0, H - 0.12, -23, 0, 0, -23, 0xc6ecff, 70, 6, 0.95, { cast: true, vol: true, priority: 2, flicker: 'fluorescent' });
  for (const [x, z] of [[-1.9, -21.2], [1.9, -24.8]] as const) {
    const h = L.point('airlock', x * 0.9, 1.5, z, 0x7fe4ff, 4, 3.5);
    b.detail(() => { b.box('painted_dark', x, 1.5, z, 0.08, 1.5, 0.1); b.box(L.glow(h, 'emissive_cyan'), x * 0.975, 1.5, z, 0.02, 1.4, 0.05); });
  }
  beacon(b, L, 'airlock', 1.6, H, -20.6, -1, 0xff9a20, 14, 6, 'emissive_amber', true, 'alarm');
  beacon(b, L, 'airlock', -1.6, H, -25.4, -1, 0xff9a20, 14, 6, 'emissive_amber', true, 'alarm');

  b.sign('DECONTAMINATION LOCK', 'stencil', -1.94, 2.55, -23, 1.6, 0.22, '+x');
  b.sign('STAND CLEAR OF NOZZLES DURING CYCLE', 'warning', 1.94, 1.75, -23.4, 0.95, 0.14, '-x', 0, true);
  b.sign('CYCLE FAULT — MANUAL OVERRIDE ENGAGED', 'danger', 1.94, 2.05, -21.6, 0.7, 0.1, '-x', 0, true);
  b.decal('water_stain', 0, -1.94, 1.2, -22.2, 0.7, 1.8, '+x');
  b.decal('water_stain', 3, 1.94, 1.1, -24.9, 0.7, 1.8, '-x');
  b.decal('handprint', 1, 0.9, 1.3, Z0 + 0.34, 0.24, 0.24, '+z', 0.2);
  b.decal('blood_smear', 0, 0.4, 0.004, -25.5, 0.6, 0.9, '+y', 0.1);
  L.ctx.fx.emitter('steam', L.vec(-1.45, 3.0, -24.4), L.vec(0.3, -1, 0), 45);
  L.ctx.fx.emitter('drip', L.vec(0.84, H - 0.36, -21.6), L.vec(0, -1, 0), 1.5);
}
