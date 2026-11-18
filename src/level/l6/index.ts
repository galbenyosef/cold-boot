/**
 * LEVEL 6 — "THE TRUNK" (stage 3d, docs/plans/stage-3d.md). K STUB (// K placeholder, the whole file): replaced by task
 * W4a (greybox, doors, phases, cover, interactables with `requireRegion`, markers, `killY −36`; §2, §3, §5.4, §8.5,
 * §8.11) — nothing here is a design decision.
 *
 * One lit 8 × 8 room round the plan's spawn (0, 0, 3): `lock6`, x −4 … 4, z −3 … 5, h 3.0, no doors, no enemies,
 * `cover: []`, `water: []` (W4b's `buildWater6`), `dock: null` (W4b's `buildDock6`), the default kill height (−30; W4a
 * sets −36). A button `l6_stub_end` on the north wall ends the level (the story stub listens for it by that literal id),
 * a placeholder screen beside it, marker `mk6_start` at the spawn. Enough for the chain to boot, play, checkpoint and end
 * level 6, and for the menu shot (story/camera.ts SHOTS_L6, eye (0, 1.7, −2)) to stand inside a room.
 */
import * as THREE from 'three';
import type { GameContext, Level } from '../../core/types';
import { LevelBuild } from '../context';
import { defineInstances } from '../props';
import { assembleLevel, buildRooms } from '../assemble';
import { buildWater6 } from './water';
import { buildDock6 } from './dock';

/** The stub room (plan box) and the spawn of §2.6.1. */
const ROOM = { x0: -4, x1: 4, z0: -3, z1: 5, h: 3.0 } as const;
export const SPAWN6 = new THREE.Vector3(0, 0, 3);
/** Interactable id of the stub's end button (src/story/l6 stub). */
export const STUB_END_ID6 = 'l6_stub_end';

function solid(L: LevelBuild, name: string, mat: Parameters<ReturnType<LevelBuild['builder']>['bx']>[0], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  L.namedBuilder(name).bx(mat, x0, y0, z0, x1, y1, z1).collide(x0, y0, z0, x1, y1, z1, 'metal', true);
}

function buildStub(L: LevelBuild) {
  const { x0, x1, z0, z1, h } = ROOM, top = h, n = 'lock6_static';
  L.room('lock6', 'TRUNK TUNNEL — HEAD-END TUBE', x0, x1, z0, z1, h);
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
  L.interact(STUB_END_ID6, 'button', 'End of the level-6 build (placeholder)', 0, 1.2, zf + 0.1, true, 2.0);
  L.screen('l6_stub_screen', 'terminal_idle', 1.2, 0.7, 1.6, 1.6, zf + 0.02, '+z', { text: 'THE TRUNK\nPLACEHOLDER BUILD (K)\nPRESS THE GREEN BUTTON TO END' });
  L.point('lock6', 0, top - 0.35, 2, 0xfff2e0, 22, 9);
  L.point('lock6', 0, top - 0.35, -1.5, 0xfff2e0, 10, 7, { priority: 0.5 });
  // marker (D22: story positions come from level objects)
  L.marker('mk6_start', SPAWN6.x, SPAWN6.y, SPAWN6.z, 0);
}

export async function createLevel6(ctx: GameContext): Promise<Level> {
  const t0 = performance.now();
  const L = new LevelBuild(ctx);
  ctx.scene.add(L.root);
  defineInstances(L);
  buildRooms(L, [['lock6', buildStub]]);
  return assembleLevel(ctx, L, {
    doors: [],
    portals: [],
    triggers: [],
    navStep: () => 1.0,
    navStart: { x: 0, z: 3 },
    spawn: { position: SPAWN6.clone(), yaw: 0 },
    startRoom: 'lock6',
    cover: [],
    water: buildWater6(L),
    dock: buildDock6(L),
    t0,
  });
}
