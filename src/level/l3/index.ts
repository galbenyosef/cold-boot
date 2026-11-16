/**
 * COLD BOOT — level 3 "THE QUIET SIDE" (stage 3a, docs/plans/stage-3a.md). STUB (task K2): one lit room so that
 * `?level=3` boots and every module runs; task K5 replaces this file with the greybox (§11).
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import { assembleLevel, buildRooms } from '../assemble';
import { floorSlab } from '../kit';
import { ceilingSlab, troffer, wallFace } from '../structure';

const H = 3.2;
/** The stub room (interior clear space). */
const X0 = -5, X1 = 5, Z0 = -10, Z1 = 0;

function buildStub(L: LevelBuild) {
  const b = L.builder('l3_stub');
  L.room('l3_stub', 'LEVEL 3 — NOT BUILT YET', X0, X1, Z0, Z1, H);
  floorSlab(b, 'floor_plate', X0, Z0, X1, Z1, [], 'metal');
  ceilingSlab(b, X0 - 0.4, Z0 - 0.4, X1 + 0.4, Z1 + 0.4, H);
  wallFace(b, { n: '+z', plane: Z0, from: X0, to: X1, h: H, seed: 301, style: 'plain', features: 0 });
  wallFace(b, { n: '-z', plane: Z1, from: X0, to: X1, h: H, seed: 302, style: 'plain', features: 0 });
  wallFace(b, { n: '+x', plane: X0, from: Z0, to: Z1, h: H, seed: 303, style: 'plain', features: 0 });
  wallFace(b, { n: '-x', plane: X1, from: Z0, to: Z1, h: H, seed: 304, style: 'plain', features: 0 });
  b.sign('LEVEL 3 — NOT BUILT YET', 'label', 0, 1.9, Z0 + 0.01, 2.6, 0.36, '+z', 0, true);
  for (const [x, z] of [[-2, -3], [2, -3], [-2, -7], [2, -7]] as const) {
    troffer(b, L, { group: 'l3_stub', x, y: H, z, axis: 'x', len: 1.2, intensity: 45, distance: 8, angle: 1.2, cast: x === -2 && z === -3 });
  }
}

export async function createLevel3(ctx: GameContext): Promise<Level> {
  const t0 = performance.now();
  const L = new LevelBuild(ctx);
  ctx.scene.add(L.root);
  defineInstances(L);
  const timings: string[] = [];
  buildRooms(L, [['l3_stub', buildStub]]);
  return assembleLevel(ctx, L, {
    doors: [],
    portals: [],
    triggers: [],
    navStep: () => 1.0,
    navStart: { x: 0, z: -2 },
    spawn: { position: new THREE.Vector3(0, 0, -2), yaw: 0 },
    startRoom: 'l3_stub',
    timings, t0,
  });
}
