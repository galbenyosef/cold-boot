/**
 * Bootstrap + main loop. Owned by the coordinator — modules must not edit this file.
 * Construction order matters: later systems may read earlier ones from ctx inside their factory;
 * anything else must be accessed lazily (inside update / event handlers).
 */
import * as THREE from 'three';
import type { GameContext, GameState } from './core/types';
import { createEvents } from './core/events';
import { createInput } from './core/input';
import { parseDebug } from './core/debug';
import { levelOf, resolveLevel } from './core/progress';
import { discardV1 } from './story/save';
import { startFacts } from './story/chain';
import { createInteractables } from './core/interactables';
import { createPhysics } from './physics/physics';
import { createRender } from './render';
import { createMaterials } from './materials';
import { createFx } from './fx';
import { createAudio } from './audio';
import { createLevel } from './level';
import { createPlayer } from './player';
import { createEnemies } from './enemies';
import { createUI } from './ui';
import { createStory } from './story';

const bootStatus = document.getElementById('boot-status')!;
const status = async (text: string) => {
  bootStatus.textContent = text;
  // Yield so the browser can paint the status line between heavy synchronous steps.
  await new Promise((r) => setTimeout(r, 0));
};

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const events = createEvents();
  const debug = parseDebug();
  // §8.1: v1 saves / carry are discarded once (the stored level starts over), before anything reads storage.
  discardV1();
  const levelId = resolveLevel(debug);

  const ctx = {
    canvas,
    uiRoot: document.getElementById('ui')!,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 200),
    events,
    input: createInput(canvas),
    physics: createPhysics(),
    // stage 3d S8g: `Interactable.requireRegion` is looked up in the level's regions (read lazily)
    interactables: createInteractables(events, () => ctx.level?.regions),
    debug,
    levelId,
    facts: startFacts(levelId, debug),
    time: 0,
    state: 'loading' as GameState,
    ready: false,
    setState(state: GameState) {
      if (state === ctx.state) return;
      const prev = ctx.state;
      ctx.state = state;
      events.emit('game:state', { state, prev });
    },
  } as GameContext;
  ctx.input.touchMode = debug.mobile; // phones / tablets: on-screen controls, no pointer lock
  (window as any).__game = ctx;
  ctx.scene.add(ctx.camera);

  await status('renderer');
  ctx.render = await createRender(ctx); // also assigns ctx.renderer
  await status('materials');
  ctx.materials = await createMaterials(ctx);
  await status('effects');
  ctx.fx = await createFx(ctx);
  await status('audio');
  ctx.audio = await createAudio(ctx);
  await status(levelOf(ctx).bootStatus);
  ctx.level = await createLevel(ctx);
  ctx.physics.build(ctx.level.colliders);
  ctx.physics.setKillY(ctx.level.killY); // stage 3d B6: the level's kill height (levels 1–5: −30)
  await status('operator');
  ctx.player = await createPlayer(ctx);
  await status('machines');
  ctx.enemies = await createEnemies(ctx);
  await status('interface');
  ctx.ui = await createUI(ctx);
  ctx.story = await createStory(ctx);
  await status('lighting');
  await ctx.render.prepare(ctx.level.probes);

  const onResize = () => {
    ctx.camera.aspect = innerWidth / innerHeight;
    // phones held sideways (aspect ~2.2): the vertical 72° fov is ~115° across — far wider than mobile shooters (80–90°).
    // camera.zoom narrows every fov alike (play, aim, cutscene shots) to MOBILE_HFOV across; never widens (iPad: 1).
    ctx.camera.zoom = debug.mobile ? mobileZoom(ctx.camera.aspect) : 1;
    ctx.camera.updateProjectionMatrix();
    ctx.render.resize(innerWidth, innerHeight);
  };
  addEventListener('resize', onResize);
  onResize();

  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 1 / 20);
    fpsAcc += rawDt; fpsFrames++;
    if (fpsAcc >= 0.5) { debug.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

    const simulating = ctx.state === 'playing' || ctx.state === 'cutscene';
    ctx.story.update(dt);
    if (simulating) {
      ctx.time += dt;
      ctx.player.update(dt);
      ctx.level.update(dt);
      ctx.enemies.update(dt);
      ctx.fx.update(dt);
      ctx.materials.update(dt);
    }
    ctx.audio.update(dt);
    ctx.ui.update(dt);
    ctx.render.render(simulating ? dt : 0);
    ctx.input.endFrame();
  };

  // Render one frame before revealing so shader compilation hitches hide behind the boot overlay.
  ctx.player.update(0);
  ctx.render.render(0);
  document.getElementById('boot')?.remove();
  ctx.ready = true;
  requestAnimationFrame((t) => { last = t; frame(t); });

  ctx.story.run().catch((e) => console.error('[story] run failed', e));
}

boot().catch((e) => {
  console.error(e);
  bootStatus.textContent = 'fatal: ' + (e?.message ?? e);
});

/** Horizontal fov (degrees) a phone in landscape gets at the base 72° vertical. */
const MOBILE_HFOV = 90;
function mobileZoom(aspect: number): number {
  const base = Math.tan(THREE.MathUtils.degToRad(72) / 2) * aspect; // tan(hfov/2) at zoom 1
  return Math.max(1, base / Math.tan(THREE.MathUtils.degToRad(MOBILE_HFOV) / 2));
}
