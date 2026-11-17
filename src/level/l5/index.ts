/**
 * LEVEL 5 — "POST 4" (stage 3c, docs/plans/stage-3c.md). K STUB (// K placeholder, the whole file): replaced by task
 * W4 (greybox, phases, cover, crawl floors, nav; §2, §3, §5.4, §8.3, §8.4) — nothing here is a design decision.
 *
 * One lit 8 × 8 room round the plan's spawn (0, 0, 3): `lock5`, x −4 … 4, z −3 … 5, h 3.6, no doors, no enemies,
 * `cover: []`. A button `l5_stub_end` on the north wall ends the level (the story stub listens for it by that literal
 * id), a placeholder screen beside it, marker `mk5_start` at the spawn. Enough for the chain to boot, play, checkpoint
 * and end level 5, and for the menu shot (story/camera.ts SHOTS_L5, eye (0, 1.7, −2)) to stand inside a room.
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import { assembleLevel, buildRooms } from '../assemble';

/** The stub room (plan box) and the spawn of §8.1. */
const ROOM = { x0: -4, x1: 4, z0: -3, z1: 5, h: 3.6 } as const;
export const SPAWN5 = new THREE.Vector3(0, 0, 3);
/** Interactable id of the stub's end button (src/story/l5 stub). */
export const STUB_END_ID5 = 'l5_stub_end';

function solid(L: LevelBuild, name: string, mat: Parameters<ReturnType<LevelBuild['builder']>['bx']>[0], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  L.namedBuilder(name).bx(mat, x0, y0, z0, x1, y1, z1).collide(x0, y0, z0, x1, y1, z1, 'metal', true);
}

function buildStub(L: LevelBuild) {
  const { x0, x1, z0, z1, h } = ROOM, top = h, n = 'lock5_static';
  L.room('lock5', 'POST 4 — GATE LOCK', x0, x1, z0, z1, h);
  // floor slab, walls 0.4 m centred on the boundary, ceiling
  solid(L, n, 'floor_plate', x0 + 0.2, -0.3, z0 + 0.2, x1 - 0.2, 0, z1 - 0.2);
  solid(L, n, 'wall_panel', x0 - 0.2, 0, z0 - 0.2, x0 + 0.2, top, z1 + 0.2);
  solid(L, n, 'wall_panel', x1 - 0.2, 0, z0 - 0.2, x1 + 0.2, top, z1 + 0.2);
  solid(L, n, 'wall_panel', x0 + 0.2, 0, z0 - 0.2, x1 - 0.2, top, z0 + 0.2);
  solid(L, n, 'wall_panel', x0 + 0.2, 0, z1 - 0.2, x1 - 0.2, top, z1 + 0.2);
  solid(L, n, 'ceiling_panel', x0 - 0.2, top, z0 - 0.2, x1 + 0.2, top + 0.3, z1 + 0.2);
  // the end button (north wall, interior face z −2.8) and a placeholder screen
  const zf = z0 + 0.2;
  L.namedBuilder(n).bx('trim_steel', -0.18, 1.0, zf, 0.18, 1.4, zf + 0.04).bx('emissive_green', -0.08, 1.12, zf + 0.04, 0.08, 1.28, zf + 0.07);
  L.interact(STUB_END_ID5, 'button', 'End of the level-5 build (placeholder)', 0, 1.2, zf + 0.1, true, 2.0);
  L.screen('l5_stub_screen', 'terminal_idle', 1.2, 0.7, 1.6, 1.6, zf + 0.02, '+z', { text: 'POST 4\nPLACEHOLDER BUILD (K)\nPRESS THE GREEN BUTTON TO END' });
  L.point('lock5', 0, top - 0.35, 2, 0xfff2e0, 22, 9);
  L.point('lock5', 0, top - 0.35, -1.5, 0xfff2e0, 10, 7, { priority: 0.5 });
  // marker (D22: story positions come from level objects)
  const mk = new THREE.Object3D();
  mk.name = 'mk5_start';
  mk.position.copy(SPAWN5);
  L.root.add(mk);
  L.objects.set('mk5_start', mk);
}

export async function createLevel5(ctx: GameContext): Promise<Level> {
  const t0 = performance.now();
  const L = new LevelBuild(ctx);
  ctx.scene.add(L.root);
  defineInstances(L);
  buildRooms(L, [['lock5', buildStub]]);
  return assembleLevel(ctx, L, {
    doors: [],
    portals: [],
    triggers: [],
    navStep: () => 1.0,
    navStart: { x: 0, z: 3 },
    spawn: { position: SPAWN5.clone(), yaw: 0 },
    startRoom: 'lock5',
    cover: [],
    t0,
  });
}
