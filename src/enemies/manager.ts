/**
 * EnemyManager: owns every machine, level spawn groups, hitscan/damage routing, noise alerts,
 * separation between bodies, update LOD, corpse cap.
 */
import * as THREE from 'three';
import type { Enemy, EnemyActor, EnemyHit, EnemyManager, EnemySpawn, EnemyType, GameContext } from '../core/types';
import { EnemyBase, type EnemyWorld } from './ai';
import { NavGraph } from './nav';
import { raycastVolumes, volumeNormal, type HitVolume, type VolumeHit } from './shared/hit';
import { syncShellEnv } from './husk/model';

export interface FactoryOpts {
  dormant: boolean; pose?: string; emerge?: boolean; delay?: number;
  /** Dormant behaviour (EnemySpawn.idle). */
  idle?: string;
  /** Build a scripted puppet (EnemyManager.actor) instead of a live machine. */
  actor?: boolean;
}
export type EnemyFactory = (world: EnemyWorld, group: string, position: THREE.Vector3, yaw: number, opts: FactoryOpts) => EnemyBase;

const MAX_CORPSES = 12;
const HISTORY = 64;
/** Visible LOD switch distances (camera → machine), with hysteresis. */
const LOD_FAR = 12, LOD_NEAR = 10;
/** Inert machines (dormant / wrecks) further than this, or in a room the level is not drawing, are hidden. */
const INERT_CULL = 45, AWAKE_CULL = 75;

interface InternalHit extends EnemyHit { _volume: HitVolume; }

export function createManager(ctx: GameContext, factories: Record<EnemyType, EnemyFactory>): EnemyManager {
  const all: EnemyBase[] = [];
  const corpses: EnemyBase[] = [];
  const pending: EnemySpawn[] = [];
  /** Scripted puppets (not in `all`: never hit, never counted). */
  const actors: EnemyBase[] = [];
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
    forceLod: -1,
    whisperUntil: 0,
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

  function create(type: EnemyType, position: THREE.Vector3, yaw: number, group: string, opts: FactoryOpts): EnemyBase {
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
      if (s.mode === 'dormant') create(s.type, s.position, s.yaw, s.group, { dormant: true, pose: s.pose, idle: s.idle });
      else pending.push(s);
    }
  }

  // ── room-visibility tags: the level hides whole room groups (portal culling); find one group per room.
  const roomTags = new Map<string, THREE.Object3D | null>();
  const roomTag = (id: string): THREE.Object3D | null => {
    let o = roomTags.get(id);
    if (o !== undefined) return o;
    o = null;
    let bestN = 1e9;
    const kids = ctx.level?.root?.children ?? [];
    for (const k of kids) {
      const rs = k.userData?.rooms as string[] | undefined;
      if (rs && rs.includes(id) && rs.length < bestN) { o = k; bestN = rs.length; }
    }
    roomTags.set(id, o);
    return o;
  };
  const camPos = new THREE.Vector3();
  const cullOne = (e: EnemyBase) => {
    const o = e.object;
    const d = o.position.distanceTo(camPos);
    const inert = !e.awake || e.settled;
    let show = !e.holdHidden && d < (inert ? INERT_CULL : AWAKE_CULL);
    if (show && (inert || e.isActor)) {
      // dormant / settled machines do not move: cache which room they are in (puppets: refresh at ~4 Hz)
      if (e.roomTagAt < 0 || (e.settled && e.roomTagAt < e.diedAt + 0.01) || (e.isActor && world.time - e.roomTagAt > 0.25)) {
        const r = ctx.level?.roomAt?.(e.position);
        e.roomTag = r ? roomTag(r.id) : e.isActor ? e.roomTag : null;
        e.roomTagAt = world.time;
      }
      if (e.roomTag && !e.roomTag.visible) show = false;
    }
    if (o.visible !== show) o.visible = show;
    const rig = e.lodRig;
    if (!rig || !show) return;
    if (world.forceLod >= 0) rig.setLod(world.forceLod);
    else if (rig.lod === 0 && d > LOD_FAR) rig.setLod(1);
    else if (rig.lod === 1 && d < LOD_NEAR) rig.setLod(0);
  };
  const visibility = () => {
    camPos.setFromMatrixPosition(ctx.camera.matrixWorld);
    for (let i = 0; i < all.length; i++) cullOne(all[i]);
    for (let i = 0; i < actors.length; i++) cullOne(actors[i]);
  };

  // ── wreck collision: a low box over each corpse, unless it would plug a doorway or trap the player
  let wreckTimer = 0;
  const wrecks = (dt: number) => {
    wreckTimer -= dt;
    if (wreckTimer > 0) return;
    wreckTimer = 0.25;
    const doors = ctx.level?.doors ?? [];
    for (let i = 0; i < corpses.length; i++) {
      const e = corpses[i];
      if (!e.wreckBox || e.wreckBody || e.wreckChecked < 0) continue;
      const b = e.wreckBox;
      let blocked = false;
      for (let d = 0; d < doors.length && !blocked; d++) {
        const dp = doors[d].position;
        const cx = Math.min(Math.max(dp.x, b.min.x), b.max.x), cz = Math.min(Math.max(dp.z, b.min.z), b.max.z);
        if (Math.hypot(cx - dp.x, cz - dp.z) < 1.2 && Math.abs(dp.y - b.min.y) < 2) blocked = true;
      }
      if (blocked) { e.wreckChecked = -1; continue; } // never: a corpse in a doorway stays walk-through
      // the player (capsule r ≈ 0.35) standing in / on it: try again later
      const pp = world.playerPos, r = 0.38;
      if (pp.x > b.min.x - r && pp.x < b.max.x + r && pp.z > b.min.z - r && pp.z < b.max.z + r && pp.y < b.max.y + 0.05 && pp.y > b.min.y - 1.8) continue;
      try { e.wreckBody = ctx.physics.addBox(b, 'robot'); } catch { e.wreckChecked = -1; }
    }
  };

  // pooled hitscan results (the caller consumes a hit immediately; 16 in flight is plenty for a shotgun blast)
  const hitPool: InternalHit[] = [];
  let hitPoolIdx = 0;

  const best: VolumeHit = { t: 0, volume: null };
  const _c = new THREE.Vector3(), _oc = new THREE.Vector3();
  let frame = 0;

  const manager: EnemyManager & { world: EnemyWorld; actors: EnemyBase[] } = {
    world, actors,
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
        e.boundCenter(_c);
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
      if (hitPool.length < 16) hitPool.push({ enemy: hitEnemy, point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, part: '', _volume: vol });
      const hit = hitPool[hitPoolIdx % hitPool.length];
      hitPoolIdx = (hitPoolIdx + 1) % 16;
      hit.enemy = hitEnemy;
      hit.point.copy(origin).addScaledVector(direction, best.t);
      volumeNormal(vol, hit.point, hit.normal);
      hit.distance = best.t; hit.part = vol.part; hit._volume = vol;
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
    removeGroup(group) {
      // Checkpoints: silent — no events, fx or sound. dispose() frees the audio loop, light and wreck box.
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].group === group) pending.splice(i, 1);
      for (let i = corpses.length - 1; i >= 0; i--) if (corpses[i].group === group) corpses.splice(i, 1);
      for (let i = all.length - 1; i >= 0; i--) {
        const e = all[i];
        if (e.group !== group) continue;
        all.splice(i, 1);
        try { e.dispose(); } catch (err) { console.warn('[enemies] removeGroup dispose failed', err); }
      }
    },
    actor(type, position, yaw = 0, pose) {
      const e = (factories[type] ?? factories.husk)(world, '', position, yaw, { dormant: false, pose, actor: true });
      actors.push(e);
      let removed = false;
      const handle: EnemyActor = {
        object: e.object,
        get position() { return e.position; },
        moveTo(point, speed) {
          if (removed) return Promise.resolve();
          return new Promise<void>((resolve) => e.puppetMove(point, speed, resolve));
        },
        setPose(p) { if (!removed) e.puppetPose(p); },
        lookAt(p) { if (!removed) e.puppetLook(p); },
        setEyes(on) { if (!removed) e.puppetEyes(on); },
        remove() {
          if (removed) return;
          removed = true;
          e.puppetStop();
          const i = actors.indexOf(e);
          if (i >= 0) actors.splice(i, 1);
          e.dispose();
        },
      };
      return handle;
    },
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
      for (let i = 0; i < actors.length; i++) {
        const e = actors[i];
        e.lodAcc += dt;
        if (!e.object.visible && ((frame + e.id) & 3) !== 0) continue; // hidden puppets tick at quarter rate
        e.update(Math.min(e.lodAcc, 0.1));
        e.lodAcc = 0;
      }
      visibility();
      for (let i = 0; i < all.length; i++) all[i].flushHits();
      wrecks(dt);
      if ((frame & 31) === 0) syncShellEnv(ctx);
      // separation between living, awake bodies
      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        if (!a.alive || !a.awake || a.ignoreSeparation) continue;
        for (let j = i + 1; j < all.length; j++) {
          const b = all[j];
          if (!b.alive || !b.awake || b.ignoreSeparation) continue;
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
