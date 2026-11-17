/**
 * LEVEL 4 — "BIOLOGICAL SYSTEMS" (stage 3b, docs/plans/stage-3b.md). K STUB: replaced by task W4 (greybox, phases,
 * doors, nav; §8.8) — nothing here is a design decision.
 *
 * One lit 8 × 8 room on Deck 2 (y 4.8) round the plan's spawn (0, 4.8, 2.6): `lock4`, x −4 … 4, z −2 … 6, h 3, no
 * doors. A button `l4_stub_end` on the north wall ends the level (the story stub listens for it), a placeholder
 * screen beside it, marker `mk4_start` at the spawn. Enough for the chain to boot, play, checkpoint and end level 4.
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import { assembleLevel, buildRooms } from '../assemble';

const D2 = 4.8;
/** The stub room (plan box) and the spawn of §8.1. */
const ROOM = { x0: -4, x1: 4, z0: -2, z1: 6, h: 3 } as const;
export const SPAWN4 = new THREE.Vector3(0, D2, 2.6);
/** Interactable id of the stub's end button (src/story/l4 stub). */
export const STUB_END_ID = 'l4_stub_end';

function solid(L: LevelBuild, name: string, mat: Parameters<ReturnType<LevelBuild['builder']>['bx']>[0], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  L.namedBuilder(name).bx(mat, x0, y0, z0, x1, y1, z1).collide(x0, y0, z0, x1, y1, z1, 'metal', true);
}

function buildStub(L: LevelBuild) {
  const { x0, x1, z0, z1, h } = ROOM, top = D2 + h, n = 'lock4_static';
  L.room('lock4', 'BIOLOGICAL SYSTEMS — OUTER LOCK', x0, x1, z0, z1, h, { y0: D2 });
  // floor slab, walls 0.4 m centred on the boundary, ceiling
  solid(L, n, 'floor_rubber', x0 + 0.2, D2 - 0.3, z0 + 0.2, x1 - 0.2, D2, z1 - 0.2);
  solid(L, n, 'wall_medical', x0 - 0.2, D2, z0 - 0.2, x0 + 0.2, top, z1 + 0.2);
  solid(L, n, 'wall_medical', x1 - 0.2, D2, z0 - 0.2, x1 + 0.2, top, z1 + 0.2);
  solid(L, n, 'wall_medical', x0 + 0.2, D2, z0 - 0.2, x1 - 0.2, top, z0 + 0.2);
  solid(L, n, 'wall_medical', x0 + 0.2, D2, z1 - 0.2, x1 - 0.2, top, z1 + 0.2);
  solid(L, n, 'ceiling_panel', x0 - 0.2, top, z0 - 0.2, x1 + 0.2, top + 0.3, z1 + 0.2);
  // the end button (north wall, interior face z −1.8) and a placeholder screen
  const zf = z0 + 0.2;
  L.namedBuilder(n).bx('trim_steel', -0.18, D2 + 1.0, zf, 0.18, D2 + 1.4, zf + 0.04).bx('emissive_green', -0.08, D2 + 1.12, zf + 0.04, 0.08, D2 + 1.28, zf + 0.07);
  L.interact(STUB_END_ID, 'button', 'End of the level-4 build (placeholder)', 0, D2 + 1.2, zf + 0.1, true, 2.0);
  L.screen('l4_stub_screen', 'terminal_idle', 1.2, 0.7, 1.6, D2 + 1.6, zf + 0.02, '+z', { text: 'BIOLOGICAL SYSTEMS\nPLACEHOLDER BUILD (K)\nPRESS THE GREEN BUTTON TO END' });
  L.point('lock4', 0, top - 0.35, 2, 0xe8f0ff, 22, 9);
  L.point('lock4', 0, top - 0.35, -0.5, 0xe8f0ff, 10, 7, { priority: 0.5 });
  // marker (§8.10: story positions come from level objects)
  const mk = new THREE.Object3D();
  mk.name = 'mk4_start';
  mk.position.copy(SPAWN4);
  L.root.add(mk);
  L.objects.set('mk4_start', mk);
}

export async function createLevel4(ctx: GameContext): Promise<Level> {
  const t0 = performance.now();
  const L = new LevelBuild(ctx);
  ctx.scene.add(L.root);
  defineInstances(L);
  buildRooms(L, [['lock4', buildStub]]);
  return assembleLevel(ctx, L, {
    doors: [],
    portals: [],
    triggers: [],
    navStep: () => 1.0,
    navStart: { x: 0, y: D2, z: 2.6 },
    spawn: { position: SPAWN4.clone(), yaw: 0 },
    startRoom: 'lock4',
    t0,
  });
}
