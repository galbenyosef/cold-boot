/** EQUIPMENT STORAGE — x 3…10, z -21…-13, h 3.2. Shelving, crates, the shotgun cage. */
import { rng } from '../builder';
import type { LevelBuild } from '../context';
import { cagePanel, floorSlab, ibeam, pipe } from '../kit';
import { cableCoil, clipboard, crate, drum, gasBottle, pallet, shelfRack, workTable } from '../props';
import { ceilingSlab, troffer, wallFace } from '../structure';

const PI = Math.PI;

export function buildStorage(L: LevelBuild) {
  const b = L.builder('storage');
  const R = rng(505);
  const H = 3.2;
  L.room('storage', 'EQUIPMENT STORAGE', 3, 10, -21, -13, H);

  floorSlab(b, 'floor_plate', 3, -21, 10, -13, [], 'metal');
  ceilingSlab(b, 3, -21.2, 10.2, -12.8, H);
  wallFace(b, { n: '+x', plane: 3.2, from: -21, to: -13, h: H, t: 0.2, openings: [{ c: -17, w: 1.6, h: 2.4 }], seed: 31, features: 0.3 });
  wallFace(b, { n: '-x', plane: 10, from: -21, to: -13, h: H, seed: 32, features: 0.4, clear: [[-16.2, -13]] });
  wallFace(b, { n: '+z', plane: -21, from: 3.2, to: 10, h: H, seed: 33, features: 0 });
  wallFace(b, { n: '-z', plane: -13, from: 3.2, to: 10, h: H, seed: 34, features: 0 });

  for (const z of [-15, -17, -19]) ibeam(b, 'trim_steel', 'x', 6.6, H - 0.1, z, 6.8, 0.12, 0.2);
  b.detail(() => {
    pipe(b, 'copper', [[3.5, H - 0.3, -20.8], [3.5, H - 0.3, -13.2]], 0.045, { every: 1.8 });
    pipe(b, 'painted_orange', [[9.6, H - 0.14, -20.8], [9.6, H - 0.14, -16.4]], 0.022, { flanges: false });
  });

  // ── racks ──
  b.at(6.9, 0, -20.66, 0, () => shelfRack(b, L, 5.2, 0.6, 2.5, 4, R, 0.8));
  b.at(7.2, 0, -19.0, 0, () => shelfRack(b, L, 4.6, 0.6, 2.5, 4, R, 0.7));
  b.at(5.3, 0, -13.34, PI, () => shelfRack(b, L, 3.6, 0.6, 2.5, 4, R, 0.8));
  b.sign('AISLE 1', 'label', 4.88, 2.2, -19.0, 0.4, 0.1, '-x', 0, true);
  b.sign('AISLE 2', 'label', 4.28, 2.2, -20.66, 0.4, 0.1, '-x', 0, true);

  // ── the cage (NE corner) ──
  const cg = L.doubleSided('floor_grate');
  const CH = 2.7;
  // south face z = -16.2, x 7.4…10
  b.at(7.4, 0, -16.2, 0, () => { for (let i = 0; i < 2; i++) cagePanel(b, cg, i * 1.3, 0.05, (i + 1) * 1.3, CH, 0, 0.05); });
  b.collide(7.4, 0, -16.24, 10, CH, -16.16);
  // west face x = 7.4: fixed panels either side of the gate (gate z -15.75…-14.55)
  b.at(7.4, 0, -13, PI / 2, () => { cagePanel(b, cg, 0, 0.05, 1.55, CH, 0, 0.05); cagePanel(b, cg, 2.75, 0.05, 3.2, CH, 0, 0.05); cagePanel(b, cg, 1.55, 2.15, 2.75, CH, 0, 0.05); });
  b.collide(7.36, 0, -14.55, 7.44, CH, -13);
  b.collide(7.36, 0, -16.2, 7.44, CH, -15.75);
  b.box('trim_steel', 8.7, CH + 0.03, -16.2, 2.7, 0.06, 0.08).box('trim_steel', 7.4, CH + 0.03, -14.6, 0.08, 0.06, 3.3);
  // the gate, swung open into the room
  b.at(7.4, 0, -15.75, PI / 2 + 2.0, () => {
    cagePanel(b, cg, -1.18, 0.08, 0, 2.12, 0, 0.05);
    b.detail(() => { b.box('steel_raw', -1.08, 1.1, 0.04, 0.12, 0.2, 0.05); b.box('painted_dark', -1.08, 1.1, 0.08, 0.06, 0.1, 0.04); });
  });
  b.at(7.4, 0, -15.75, PI / 2 + 2.0, () => b.collide(-1.18, 0, -0.04, 0, 2.1, 0.04));
  b.sign('CONTROLLED ITEMS — SECURITY RELEASE ONLY', 'danger', 7.37, 2.4, -14.0, 1.1, 0.16, '-x', 0, true);
  // inside: table with the shotgun, ammo, gas bottles chained to the wall
  b.at(9.62, 0, -14.6, 0, () => workTable(b, 0.7, 1.8, 0.9));
  b.detail(() => { b.box('rubber', 9.62, 0.903, -14.6, 0.5, 0.006, 1.3); b.box('painted_dark', 9.98, 1.5, -14.6, 0.03, 0.7, 1.6); for (let i = 0; i < 4; i++) b.box('steel_raw', 9.94, 1.3 + i * 0.15, -14.6, 0.06, 0.02, 1.5); });
  L.pickup('p_shotgun', 'shotgun', 9.6, 0.91, -14.6, 6, 0);
  L.pickup('p_storage_shells', 'ammo_shotgun', 9.6, 0.91, -13.95, 6, 0.3);
  for (let i = 0; i < 3; i++) b.at(7.75 + i * 0.26, 0, -13.22, i, () => gasBottle(b, i === 1 ? 'painted_orange' : 'painted_white'));
  b.detail(() => b.rod('steel_raw', 7.6, 0.9, -13.36, 8.45, 0.9, -13.36, 0.008, 4));
  b.collide(7.6, 0, -13.4, 8.45, 1.3, -13.05);
  b.at(8.9, 0, -15.5, 0.3, () => crate(b, 0.8, 0.5, 0.6, 'painted_dark', 'ERIDU SEC'));

  // ── floor stock ──
  b.at(4.3, 0, -15.3, 0.1, () => { pallet(b); b.at(0, 0.145, 0, 0, () => crate(b, 1.0, 0.7, 0.8, 'wall_panel', 'SPARES')); });
  b.at(4.3, 0, -15.3, 0.1, () => b.collide(-0.6, 0, -0.5, 0.6, 0.85, 0.5));
  b.at(4.25, 0.845, -15.3, 0.4, () => crate(b, 0.6, 0.4, 0.5, 'painted_yellow', undefined, false));
  b.at(6.2, 0, -16.6, -0.2, () => crate(b, 0.9, 0.6, 0.7, 'painted_dark', 'HALCYON'));
  L.pickup('p_storage_med', 'medkit', 6.2, 0.6, -16.6, 35, 0.5);
  b.at(4.1, 0, -18.6, 0, () => crate(b, 0.7, 0.8, 0.6, 'wall_panel_dark', 'LOT 3-A'));
  b.at(4.1, 0.8, -18.6, 0.5, () => clipboard(b));
  L.interact('log_storage', 'log', 'Read note', 4.1, 0.85, -18.6);
  b.at(9.35, 0, -17.2, 0, () => drum(b, 'painted_orange'));
  b.at(9.4, 0, -17.85, 0, () => drum(b, 'painted_yellow'));
  b.at(8.75, 0, -17.5, 0, () => drum(b, 'painted_orange'));
  b.at(5.6, 0, -17.9, 0, () => cableCoil(b, 0.32, 5));
  b.decal('oil_stain', 0, 8.9, 0.002, -17.6, 1.6, 1.4, '+y', 0.4);
  b.decal('scratches', 3, 5.5, 0.002, -16.9, 1.4, 1.4, '+y', 0.9);
  b.decal('grime', 1, 7, 0.002, -19.85, 3, 0.9, '+y');

  // ── lights: one troffer by the door, an amber cage lamp throwing mesh shadows across the floor ──
  troffer(b, L, { group: 'storage', x: 5.0, y: H, z: -17.0, axis: 'z', intensity: 75, distance: 8, angle: 1.1, flicker: 'fluorescent', cast: true });
  troffer(b, L, { group: 'storage', x: 7.4, y: H, z: -19.8, axis: 'x', dead: true });
  const cage = L.spot('storage', 9.3, 2.85, -13.7, 6.2, 0, -17.2, 0xffa850, 60, 9, 0.95, { cast: true, priority: 2, penumbra: 0.7 });
  b.detail(() => { b.box('painted_dark', 9.3, 3.0, -13.7, 0.25, 0.2, 0.25); b.sphere(L.glow(cage, 'emissive_amber'), 9.3, 2.88, -13.7, 0.07, 8); for (let i = 0; i < 4; i++) b.rod('steel_raw', 9.3 + Math.cos(i * PI / 2) * 0.09, 2.95, -13.7 + Math.sin(i * PI / 2) * 0.09, 9.3 + Math.cos(i * PI / 2) * 0.09, 2.78, -13.7 + Math.sin(i * PI / 2) * 0.09, 0.005, 4); });
  L.point('storage', 8.0, 0.6, -19.85, 0xff3010, 1.2, 2.5, { flicker: 'pulse' });

  b.sign('EQUIPMENT STORAGE', 'stencil', 3.236, 2.3, -14.9, 1.4, 0.22, '+x');
  b.sign('STACK MAX 3 HIGH', 'warning', 9.964, 1.8, -18.8, 0.7, 0.14, '-x', 0, true);
  L.navNode(8.7, -14.9, 'storage'); L.navNode(8.3, -15.2, 'storage'); L.navNode(6.5, -19.85, 'storage'); L.navNode(8.3, -19.85, 'storage'); L.navNode(5.0, -19.85, 'storage');
  L.enemy('g_storage', 'skitter', 'spawn', 8.7, 0, -19.85, PI / 2);
  L.ctx.fx.emitter('dust', L.vec(6.5, 1.5, -16.5), L.vec(0, -1, 0), 4);
}
