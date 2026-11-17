/**
 * Enemies module entry. Builds the machine templates (procedural geometry, shared materials) and returns the
 * EnemyManager. See manager.ts / ai.ts / nav.ts and one folder per enemy type.
 *
 * Level 1 builds exactly what it always did (husk, skitter, sentry). The REVISION 4 templates — `foreman` and the
 * `human` actor (Tomas) — are built up front only when the level can use them (level 2, or a level that lists a
 * foreman spawn); otherwise they are built lazily on first use.
 */
import * as THREE from 'three';
import type { EnemyManager, EnemySkin, GameContext } from '../core/types';
import { createManager, type EnemyFactory, type ActorFactories } from './manager';
import { buildHuskTemplate, type HuskTemplate } from './husk/model';
import { Husk } from './husk/husk';
import { buildSkitterTemplate } from './skitter/model';
import { Skitter } from './skitter/skitter';
import { buildSentryTemplate, type SentryTemplate } from './sentry/model';
import { Sentry } from './sentry/sentry';
import { buildForemanTemplate, type ForemanTemplate } from './foreman/model';
import { Foreman } from './foreman/foreman';
import { buildHumanTemplate, type HumanTemplate } from './human/model';
import { Human } from './human/human';
import { loadTomasHead } from './human/head';
import { buildHalvorsenTemplate } from './human/halvorsen';
import { Halvorsen } from './human/halvorsen-actor';
import { loadHalvorsenHead } from './human/head2';
import { levelOf } from '../core/progress';

export async function createEnemies(ctx: GameContext): Promise<EnemyManager> {
  const t0 = performance.now();
  const huskTpl = buildHuskTemplate(ctx);
  const skitterTpl = buildSkitterTemplate(ctx);
  const sentryTpl = buildSentryTemplate(ctx);
  let foremanTpl: ForemanTemplate | null = null;
  let humanTpl: HumanTemplate | null = null;
  let halvTpl: HumanTemplate | null = null;
  const getForeman = () => (foremanTpl ??= buildForemanTemplate(ctx));
  const getHuman = () => (humanTpl ??= buildHumanTemplate(ctx));
  const getHalv = () => (halvTpl ??= buildHalvorsenTemplate(ctx));
  /** §8.8: `ActorOpts.who` of the actor being created (FactoryOpts does not carry it; see the actor() wrapper below). */
  let nextWho: string | undefined;
  // Stage 3b §8.4: skinned husk / sentry templates (a look only), built on first use or up front for the level's spawns
  const huskSkins = new Map<EnemySkin, HuskTemplate>(), sentrySkins = new Map<EnemySkin, SentryTemplate>();
  const huskOf = (skin?: EnemySkin): HuskTemplate => {
    if (!skin) return huskTpl;
    let t = huskSkins.get(skin);
    if (!t) huskSkins.set(skin, (t = buildHuskTemplate(ctx, skin)));
    return t;
  };
  const sentryOf = (skin?: EnemySkin): SentryTemplate => {
    if (!skin) return sentryTpl;
    let t = sentrySkins.get(skin);
    if (!t) sentrySkins.set(skin, (t = buildSentryTemplate(ctx, skin)));
    return t;
  };
  const husk: EnemyFactory = (world, group, position, yaw, o) => new Husk(world, huskOf(o.skin), group, position, yaw, o);
  const skitter: EnemyFactory = (world, group, position, yaw, o) => new Skitter(world, skitterTpl, group, position, yaw, o);
  const sentry: EnemyFactory = (world, group, position, yaw, o) => new Sentry(world, sentryOf(o.skin), group, position, yaw, o);
  const skinned: { type: 'husk' | 'sentry'; skin: EnemySkin }[] = [];
  for (const s of ctx.level?.enemySpawns ?? []) {
    if (!s.skin || (s.type !== 'husk' && s.type !== 'sentry')) continue;
    if (skinned.some((k) => k.type === s.type && k.skin === s.skin)) continue;
    skinned.push({ type: s.type, skin: s.skin });
    if (s.type === 'husk') huskOf(s.skin); else sentryOf(s.skin);
  }
  const foreman: EnemyFactory = (world, group, position, yaw, o) => new Foreman(world, getForeman(), group, position, yaw, o);
  const human: EnemyFactory = (world, group, position, yaw, o) =>
    nextWho === 'halvorsen' ? new Halvorsen(world, getHalv(), group, position, yaw, o) : new Human(world, getHuman(), group, position, yaw, o);
  const extra: ActorFactories = { human };
  // §8.1: the level's cast (LEVELS[id].cast) — level 2 foreman + Tomas, level 3 the human template (Halvorsen)
  const cast = levelOf(ctx).cast;
  const needForeman = cast.foreman || (ctx.level?.enemySpawns ?? []).some((s) => s.type === 'foreman');
  if (needForeman) getForeman();
  // level 3's human is Halvorsen (its cast has the human template but not Tomas's head); the dev harness can ask for him
  const wantHalv = (cast.human && !cast.tomasHead) || !!(ctx as unknown as { devCast?: { halvorsen?: boolean } }).devCast?.halvorsen;
  if (cast.human && (cast.tomasHead || !wantHalv)) getHuman();
  if (wantHalv) {
    const tpl = getHalv();
    if ((ctx as unknown as { devCast?: { noHead?: boolean } }).devCast?.noHead) tpl.head2 = null; // dev: the fallback head
    else try {
      tpl.head2 = await Promise.race([
        loadHalvorsenHead(ctx, tpl),
        new Promise<null>((res) => setTimeout(() => res(null), 12000)),
      ]);
      if (!tpl.head2) console.warn('[enemies] Halvorsen head asset timed out — procedural head');
    } catch (e) {
      console.warn('[enemies] Halvorsen head asset failed — procedural head', e);
      tpl.head2 = null;
    }
  }
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
  // §8.8: route ActorOpts.who to the human factory and expose Halvorsen's props on his handle (`prop?(name, value)`).
  {
    const baseActor = manager.actor.bind(manager);
    manager.actor = (type, position, yaw, pose, opts) => {
      nextWho = type === 'human' ? opts?.who : undefined;
      let made: Halvorsen | null = null;
      try {
        const n0 = (manager as unknown as { actors: unknown[] }).actors.length;
        const h = baseActor(type, position, yaw, pose, opts);
        const e = (manager as unknown as { actors: unknown[] }).actors[n0];
        if (e instanceof Halvorsen) made = e;
        if (made) { const m = made; (h as unknown as { prop(n: string, v: unknown): void }).prop = (n, v) => m.prop(n, v); }
        return h;
      } finally { nextWho = undefined; }
    };
  }
  const templates: Record<string, unknown> = { husk: huskTpl, skitter: skitterTpl, sentry: sentryTpl };
  if (foremanTpl) templates.foreman = foremanTpl;
  if (humanTpl) templates.human = humanTpl;
  if (halvTpl) templates.halvorsen = halvTpl;
  for (const [k, t] of huskSkins) templates['husk_' + k] = t;
  for (const [k, t] of sentrySkins) templates['sentry_' + k] = t;
  (manager as any).templates = templates;
  // Pre-warm: one hidden, never-updated puppet per type stays in the scene so render.prepare() compiles every
  // enemy program (hero LOD, distance LOD, shadow proxy, glow) even when no machine of that type exists yet —
  // actors / spawn groups created later then reuse those programs (no first-sight compile hitch).
  const warmWorld = (manager as any).world;
  const warm = [husk, skitter, sentry];
  if (needForeman) warm.push(foreman);
  if (cast.human && (cast.tomasHead || !wantHalv)) warm.push(human);
  if (wantHalv) warm.push((world, group, position, yaw, o) => new Halvorsen(world, getHalv(), group, position, yaw, o));
  for (const { type, skin } of skinned) {
    const f = type === 'husk' ? husk : sentry;
    warm.push((world, group, position, yaw, o) => f(world, group, position, yaw, { ...o, skin }));
  }
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
    if (halvTpl) s += `, halvorsen ${d(halvTpl)}`;
    console.log(s);
  }
  return manager;
}
