/**
 * Enemies module entry. Builds the machine templates (procedural geometry, shared materials) and returns the
 * EnemyManager. See manager.ts / ai.ts / nav.ts and one folder per enemy type.
 *
 * Level 1 builds exactly what it always did (husk, skitter, sentry). The REVISION 4 templates — `foreman` and the
 * `human` actor (Tomas) — are built up front only when the level can use them (level 2, or a level that lists a
 * foreman spawn); otherwise they are built lazily on first use.
 */
import * as THREE from 'three';
import type { EnemyManager, GameContext } from '../core/types';
import { createManager, type EnemyFactory, type ActorFactories } from './manager';
import { buildHuskTemplate } from './husk/model';
import { Husk } from './husk/husk';
import { buildSkitterTemplate } from './skitter/model';
import { Skitter } from './skitter/skitter';
import { buildSentryTemplate } from './sentry/model';
import { Sentry } from './sentry/sentry';
import { buildForemanTemplate, type ForemanTemplate } from './foreman/model';
import { Foreman } from './foreman/foreman';
import { buildHumanTemplate, type HumanTemplate } from './human/model';
import { Human } from './human/human';
import { loadTomasHead } from './human/head';
import { levelOf } from '../core/progress';

export async function createEnemies(ctx: GameContext): Promise<EnemyManager> {
  const t0 = performance.now();
  const huskTpl = buildHuskTemplate(ctx);
  const skitterTpl = buildSkitterTemplate(ctx);
  const sentryTpl = buildSentryTemplate(ctx);
  let foremanTpl: ForemanTemplate | null = null;
  let humanTpl: HumanTemplate | null = null;
  const getForeman = () => (foremanTpl ??= buildForemanTemplate(ctx));
  const getHuman = () => (humanTpl ??= buildHumanTemplate(ctx));
  const husk: EnemyFactory = (world, group, position, yaw, o) => new Husk(world, huskTpl, group, position, yaw, o);
  const skitter: EnemyFactory = (world, group, position, yaw, o) => new Skitter(world, skitterTpl, group, position, yaw, o);
  const sentry: EnemyFactory = (world, group, position, yaw, o) => new Sentry(world, sentryTpl, group, position, yaw, o);
  const foreman: EnemyFactory = (world, group, position, yaw, o) => new Foreman(world, getForeman(), group, position, yaw, o);
  const human: EnemyFactory = (world, group, position, yaw, o) => new Human(world, getHuman(), group, position, yaw, o);
  const extra: ActorFactories = { human };
  // §8.1: the level's cast (LEVELS[id].cast) — level 2 foreman + Tomas, level 3 the human template (Halvorsen)
  const cast = levelOf(ctx).cast;
  const needForeman = cast.foreman || (ctx.level?.enemySpawns ?? []).some((s) => s.type === 'foreman');
  if (needForeman) getForeman();
  if (cast.human) getHuman();
  // REVISION 5: Tomas's scanned head (level 2 only); the procedural face stays if it cannot be loaded in time
  if (cast.tomasHead && humanTpl) {
    const tpl = humanTpl as HumanTemplate;
    try {
      tpl.scan = await Promise.race([
        loadTomasHead(ctx, tpl),
        new Promise<null>((res) => setTimeout(() => res(null), 12000)),
      ]);
      if (!tpl.scan) console.warn('[enemies] Tomas head asset timed out — procedural head');
    } catch (e) {
      console.warn('[enemies] Tomas head asset failed — procedural head', e);
      tpl.scan = null;
    }
  }
  const manager = createManager(ctx, { husk, skitter, sentry, foreman }, extra);
  const templates: Record<string, unknown> = { husk: huskTpl, skitter: skitterTpl, sentry: sentryTpl };
  if (foremanTpl) templates.foreman = foremanTpl;
  if (humanTpl) templates.human = humanTpl;
  (manager as any).templates = templates;
  // Pre-warm: one hidden, never-updated puppet per type stays in the scene so render.prepare() compiles every
  // enemy program (hero LOD, distance LOD, shadow proxy, glow) even when no machine of that type exists yet —
  // actors / spawn groups created later then reuse those programs (no first-sight compile hitch).
  const warmWorld = (manager as any).world;
  const warm = [husk, skitter, sentry];
  if (needForeman) warm.push(foreman);
  if (cast.human) warm.push(human);
  for (const f of warm) {
    const e = f(warmWorld, '', new THREE.Vector3(0, -400, 0), 0, { dormant: false, pose: 'idle', actor: true });
    e.puppetEyes(true);
    e.object.visible = false;
    e.object.traverse((o) => { o.frustumCulled = false; });
  }
  if (ctx.debug.verbose) {
    const d = (t: { rig: { triangles: number; drawCalls: number; lod1Triangles: number; lod1: unknown[]; shadowTriangles: number } }) =>
      `${t.rig.triangles} tris / ${t.rig.drawCalls} draws (lod1 ${t.rig.lod1Triangles} / ${t.rig.lod1.length}, shadow ${t.rig.shadowTriangles})`;
    let s = `[enemies] templates built in ${(performance.now() - t0).toFixed(0)} ms — husk ${d(huskTpl)}, skitter ${d(skitterTpl)}, sentry ${d(sentryTpl)}`;
    if (foremanTpl) s += `, foreman ${d(foremanTpl)}`;
    if (humanTpl) s += `, human ${d(humanTpl)}`;
    console.log(s);
  }
  return manager;
}
