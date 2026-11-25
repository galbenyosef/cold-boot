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
import { releaseBigAllocations, trackBigAllocations } from './core/release';
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
import { createGamepad } from './core/gamepad';
import { createStory } from './story';
import { BootBar, type BootStep } from './core/bootbar';

const bootStatus = document.getElementById('boot-status')!;
let bar: BootBar | null = null;
const status = async (text: string, step: BootStep) => {
  bootStatus.textContent = text;
  // Yield so the browser paints the status line and starts the bar's run towards this step's end.
  if (bar) await bar.step(step);
  else await new Promise((r) => setTimeout(r, 0));
};

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const events = createEvents();
  const debug = parseDebug();
  if (debug.mobile) trackBigAllocations(); // freed on pagehide (releaseOnLeave)
  // §8.1: v1 saves / carry are discarded once (the stored level starts over), before anything reads storage.
  discardV1();
  const levelId = resolveLevel(debug);
  bar = new BootBar(debug.mobile, levelId);

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
  if (debug.mobile) releaseOnLeave(ctx);
  (window as any).__game = ctx;
  ctx.scene.add(ctx.camera);

  await status('renderer', 'renderer');
  ctx.render = await createRender(ctx); // also assigns ctx.renderer
  await status('materials', 'materials');
  ctx.materials = await createMaterials(ctx);
  await status('effects', 'effects');
  ctx.fx = await createFx(ctx);
  await status('audio', 'audio');
  ctx.audio = await createAudio(ctx);
  await status(levelOf(ctx).bootStatus, 'level');
  ctx.level = await createLevel(ctx);
  ctx.physics.build(ctx.level.colliders);
  ctx.physics.setKillY(ctx.level.killY); // stage 3d B6: the level's kill height (levels 1–5: −30)
  await status('operator', 'player');
  ctx.player = await createPlayer(ctx);
  await status('machines', 'enemies');
  ctx.enemies = await createEnemies(ctx);
  await status('interface', 'interface');
  ctx.ui = await createUI(ctx);
  ctx.story = await createStory(ctx);
  await status('lighting', 'lighting');
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

  const gamepad = createGamepad(ctx);
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 1 / 20);
    fpsAcc += rawDt; fpsFrames++;
    if (fpsAcc >= 0.5) { debug.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

    gamepad.update(dt);
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
  bar?.done();
  const bootEl = document.getElementById('boot');
  if (bootEl) { bootEl.classList.add('done'); setTimeout(() => bootEl.remove(), 350); }
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

/**
 * Phones: every level change / restart reloads the page, and iOS Safari boots the new page in the same process while
 * the old page's memory waits for a full garbage collection — the new boot then runs out of memory. So on leaving,
 * drop the WebGL and audio contexts and free the big buffers / canvases at once (src/core/release.ts); a page restored
 * from the back/forward cache reloads instead.
 */
function releaseOnLeave(ctx: GameContext): void {
  addEventListener('pagehide', () => {
    try { (ctx.renderer?.getContext().getExtension('WEBGL_lose_context') as WEBGL_lose_context | null)?.loseContext(); } catch { /* ignore */ }
    try { void (ctx.audio as unknown as { debug?: { engine?: { ctx?: AudioContext } } })?.debug?.engine?.ctx?.close(); } catch { /* ignore */ }
    try { releaseBigAllocations(ctx.scene); } catch { /* ignore */ }
  });
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}
