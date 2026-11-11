/**
 * Enemies module entry. Builds the three machine templates once (procedural geometry, shared materials)
 * and returns the EnemyManager. See manager.ts / ai.ts / nav.ts and one folder per enemy type.
 */
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
  const husk: EnemyFactory = (world, group, position, yaw, o) => new Husk(world, huskTpl, group, position, yaw, o.dormant, o.pose);
  const skitter: EnemyFactory = (world, group, position, yaw, o) => new Skitter(world, skitterTpl, group, position, yaw, o);
  const sentry: EnemyFactory = (world, group, position, yaw, o) => new Sentry(world, sentryTpl, group, position, yaw, o);
  const manager = createManager(ctx, { husk, skitter, sentry });
  (manager as any).templates = { husk: huskTpl, skitter: skitterTpl, sentry: sentryTpl };
  if (ctx.debug.verbose) {
    const d = (t: { rig: { triangles: number; drawCalls: number; lod1Triangles: number; lod1: unknown[]; shadowTriangles: number } }) =>
      `${t.rig.triangles} tris / ${t.rig.drawCalls} draws (lod1 ${t.rig.lod1Triangles} / ${t.rig.lod1.length}, shadow ${t.rig.shadowTriangles})`;
    console.log(`[enemies] templates built in ${(performance.now() - t0).toFixed(0)} ms — husk ${d(huskTpl)}, skitter ${d(skitterTpl)}, sentry ${d(sentryTpl)}`);
  }
  return manager;
}
