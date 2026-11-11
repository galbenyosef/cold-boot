/**
 * Enemies module entry. Builds the three machine templates once (procedural geometry, shared materials)
 * and returns the EnemyManager. See manager.ts / ai.ts / nav.ts and one folder per enemy type.
 */
import * as THREE from 'three';
import type { EnemyManager, GameContext } from '../core/types';
import { createManager, type EnemyFactory } from './manager';
import { buildHuskTemplate } from './husk/model';
import { Husk } from './husk/husk';
import { buildSkitterTemplate } from './skitter/model';
import { Skitter } from './skitter/skitter';
import { buildSentryTemplate } from './sentry/model';
import { Sentry } from './sentry/sentry';

export async function createEnemies(ctx: GameContext): Promise<EnemyManager> {
  const t0 = performance.now();
  const huskTpl = buildHuskTemplate(ctx);
  const skitterTpl = buildSkitterTemplate(ctx);
  const sentryTpl = buildSentryTemplate(ctx);
  const husk: EnemyFactory = (world, group, position, yaw, o) => new Husk(world, huskTpl, group, position, yaw, o);
  const skitter: EnemyFactory = (world, group, position, yaw, o) => new Skitter(world, skitterTpl, group, position, yaw, o);
  const sentry: EnemyFactory = (world, group, position, yaw, o) => new Sentry(world, sentryTpl, group, position, yaw, o);
  const manager = createManager(ctx, { husk, skitter, sentry });
  (manager as any).templates = { husk: huskTpl, skitter: skitterTpl, sentry: sentryTpl };
  // Pre-warm: one hidden, never-updated puppet per type stays in the scene so render.prepare() compiles every
  // enemy program (hero LOD, distance LOD, shadow proxy, glow) even when no machine of that type exists yet —
  // actors / spawn groups created later then reuse those programs (no first-sight compile hitch).
  const warmWorld = (manager as any).world;
  for (const f of [husk, skitter, sentry]) {
    const e = f(warmWorld, '', new THREE.Vector3(0, -400, 0), 0, { dormant: false, pose: 'idle', actor: true });
    e.puppetEyes(true);
    e.object.visible = false;
    e.object.traverse((o) => { o.frustumCulled = false; });
  }
  if (ctx.debug.verbose) {
    const d = (t: { rig: { triangles: number; drawCalls: number; lod1Triangles: number; lod1: unknown[]; shadowTriangles: number } }) =>
      `${t.rig.triangles} tris / ${t.rig.drawCalls} draws (lod1 ${t.rig.lod1Triangles} / ${t.rig.lod1.length}, shadow ${t.rig.shadowTriangles})`;
    console.log(`[enemies] templates built in ${(performance.now() - t0).toFixed(0)} ms — husk ${d(huskTpl)}, skitter ${d(skitterTpl)}, sentry ${d(sentryTpl)}`);
  }
  return manager;
}
