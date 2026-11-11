/**
 * EnemyManager: owns every machine, level spawn groups, hitscan/damage routing, noise alerts,
 * separation between bodies, update LOD, corpse cap.
 */
import * as THREE from 'three';
import type { Enemy, EnemyHit, EnemyManager, EnemySpawn, EnemyType, GameContext } from '../core/types';
import { EnemyBase, type EnemyWorld } from './ai';
import { NavGraph } from './nav';
import { raycastVolumes, volumeNormal, type HitVolume, type VolumeHit } from './shared/hit';

export type EnemyFactory = (world: EnemyWorld, group: string, position: THREE.Vector3, yaw: number, opts: { dormant: boolean; pose?: string; emerge?: boolean; delay?: number }) => EnemyBase;

const MAX_CORPSES = 12;
const HISTORY = 64;

interface InternalHit extends EnemyHit { _volume: HitVolume; }

export function createManager(ctx: GameContext, factories: Record<EnemyType, EnemyFactory>): EnemyManager {
  const all: EnemyBase[] = [];
  const corpses: EnemyBase[] = [];
  const pending: EnemySpawn[] = [];
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // player eye history for lagged aiming
  const histPos = new Float32Array(HISTORY * 3), histTime = new Float32Array(HISTORY).fill(-1e9);
  let histHead = 0;

  const world: EnemyWorld = {
    ctx, nav: new NavGraph(ctx), enemies: all, time: 0,
    playerPos: new THREE.Vector3(0, -1000, 0), playerEye: new THREE.Vector3(0, -1000, 0), playerVel: new THREE.Vector3(), playerAlive: false,
    playerEyeAgo(seconds, out) {
      const want = world.time - seconds;
      let best = (histHead + HISTORY - 1) % HISTORY;
      for (let k = 0; k < HISTORY; k++) {
        const i = (histHead + HISTORY - 1 - k) % HISTORY;
        best = i;
        if (histTime[i] <= want) break;
      }
      if (histTime[best] < -1e8) return out.copy(world.playerEye);
      return out.set(histPos[best * 3], histPos[best * 3 + 1], histPos[best * 3 + 2]);
    },
    rand,
    onDeath(e) {
      ctx.events.emit('enemy:died', { id: e.id, type: e.type, position: e.position, group: e.group });
      corpses.push(e);
      while (corpses.length > MAX_CORPSES) {
        const old = corpses.shift()!;
        old.dispose();
        const i = all.indexOf(old);
        if (i >= 0) all.splice(i, 1);
      }
      if (e.group && aliveInGroup(e.group) === 0 && !pending.some((s) => s.group === e.group)) {
        ctx.events.emit('enemy:group-cleared', { group: e.group });
      }
    },
  };

  function create(type: EnemyType, position: THREE.Vector3, yaw: number, group: string, opts: { dormant: boolean; pose?: string; emerge?: boolean; delay?: number }): EnemyBase {
    const f = factories[type] ?? factories.husk;
    const e = f(world, group, position, yaw, opts);
    all.push(e);
    return e;
  }

  function aliveInGroup(group: string): number {
    let n = 0;
    for (let i = 0; i < all.length; i++) if (all[i].alive && all[i].group === group) n++;
    return n;
  }

  if (!ctx.debug.noEnemies) {
    for (const s of ctx.level.enemySpawns ?? []) {
      if (s.mode === 'dormant') create(s.type, s.position, s.yaw, s.group, { dormant: true, pose: s.pose });
      else pending.push(s);
    }
  }

  const best: VolumeHit = { t: 0, volume: null };
  const _c = new THREE.Vector3(), _oc = new THREE.Vector3();
  let frame = 0;

  const manager: EnemyManager & { world: EnemyWorld } = {
    world,
    all: all as readonly Enemy[],
    get activeCount() {
      let n = 0;
      for (let i = 0; i < all.length; i++) if (all[i].hunting) n++;
      return n;
    },
    spawn(type, position, yaw = 0, group = '') {
      return create(type, position, yaw, group, { dormant: false });
    },
    spawnGroup(group) {
      if (ctx.debug.noEnemies) return;
      let k = 0;
      for (let i = pending.length - 1; i >= 0; i--) {
        const s = pending[i];
        if (s.group !== group) continue;
        pending.splice(i, 1);
        create(s.type, s.position, s.yaw, s.group, { dormant: false, pose: s.pose, emerge: true, delay: k * 0.45 });
        k++;
      }
    },
    wakeGroup(group, stagger = 0.6) {
      let k = 0;
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e.group !== group || !e.alive || e.awake) continue;
        e.wake(k * stagger);
        k++;
      }
    },
    hitscan(origin, direction, maxDistance) {
      best.t = maxDistance; best.volume = null;
      let hitEnemy: EnemyBase | null = null;
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (!e.alive) continue;
        // broad phase: ray vs bounding sphere
        _c.copy(e.object.position); _c.y += e.boundCenterY;
        _oc.copy(_c).sub(origin);
        const tca = _oc.dot(direction);
        const d2 = _oc.lengthSq() - tca * tca;
        const r = e.boundRadius;
        if (d2 > r * r) continue;
        if (tca < -r || tca - r > best.t) continue;
        if (raycastVolumes(e.volumes, origin, direction, best)) hitEnemy = e;
      }
      const vol = best.volume as HitVolume | null;
      if (!hitEnemy || !vol) return null;
      const point = new THREE.Vector3().copy(origin).addScaledVector(direction, best.t);
      const hit: InternalHit = {
        enemy: hitEnemy, point, normal: volumeNormal(vol, point, new THREE.Vector3()), distance: best.t, part: vol.part, _volume: vol,
      };
      return hit;
    },
    damage(hit, amount, direction) {
      const e = hit.enemy as EnemyBase;
      if (!e || !e.alive || typeof e.applyDamage !== 'function') return;
      let vol = (hit as InternalHit)._volume;
      if (!vol) vol = e.volumes.find((v) => v.part === hit.part) ?? e.volumes[0];
      e.applyDamage(vol, amount, hit.point, direction);
    },
    alertNoise(point, radius) {
      const r2 = radius * radius;
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (!e.alive || !e.awake || e.state !== 'idle') continue;
        if (e.position.distanceToSquared(point) <= r2) e.alert();
      }
    },
    aliveInGroup,
    update(dt) {
      if (dt <= 0) return;
      world.time += dt;
      frame++;
      const pl = ctx.player;
      if (pl) {
        world.playerPos.copy(pl.position); world.playerEye.copy(pl.eye);
        if (pl.velocity) world.playerVel.copy(pl.velocity);
        world.playerAlive = pl.alive && !ctx.debug.noEnemies;
        histPos[histHead * 3] = pl.eye.x; histPos[histHead * 3 + 1] = pl.eye.y; histPos[histHead * 3 + 2] = pl.eye.z;
        histTime[histHead] = world.time;
        histHead = (histHead + 1) % HISTORY;
      }
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e.settled) continue;
        e.lodAcc += dt;
        // far-away machines tick at half rate
        if (e.dist > 28 && e.awake && ((frame + e.id) & 1) === 0) continue;
        e.update(Math.min(e.lodAcc, 0.1));
        e.lodAcc = 0;
      }
      // separation between living, awake bodies
      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        if (!a.alive || !a.awake) continue;
        for (let j = i + 1; j < all.length; j++) {
          const b = all[j];
          if (!b.alive || !b.awake) continue;
          const pa = a.body.position, pb = b.body.position;
          const min = a.body.radius + b.body.radius + 0.12;
          const dx = pb.x - pa.x, dz = pb.z - pa.z;
          if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
          const dy = pb.y - pa.y;
          if (dy > a.body.height || -dy > b.body.height) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          const push = Math.min(0.04, (min - d) * 0.5);
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          pa.x -= nx * push; pa.z -= nz * push; pb.x += nx * push; pb.z += nz * push;
          const k = 2.5 * dt * 10;
          a.body.velocity.x -= nx * k; a.body.velocity.z -= nz * k; b.body.velocity.x += nx * k; b.body.velocity.z += nz * k;
        }
      }
    },
  };
  return manager;
}
