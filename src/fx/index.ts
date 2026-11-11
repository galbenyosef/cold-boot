/**
 * FX system: sparks, smoke/steam/dust, fluid, decals, flashes, arcs, explosions, debris, emitters.
 *
 * Draw calls (only when something of that kind is alive): puffs 1, streaks 1, arcs 1,
 * decals 1 per used (name, variant) batch, generic debris 1 per shard shape (4).
 * Everything is pooled and built at load; steady-state frames allocate nothing.
 *
 * Auto-handled events: 'bullet:impact' (decal + sparks/dust/chips by surface).
 * Hits on machines are NOT handled here: the enemies module owns its hit effects (scaled by damage / part,
 * coalesced per enemy per frame) and calls sparks()/fluid()/flash() itself.
 */
import * as THREE from 'three';
import type { DecalName, FxSystem, GameContext, Quality, Surface } from '../core/types';
import { Streaks, ST } from './streaks';
import { Puffs, SHAPE } from './puffs';
import { Flashes } from './flashes';
import { Decals } from './decals';
import { Arcs, type ArcSlot } from './arcs';
import { Debris } from './debris';
import { createPuffAtlas } from './textures';
import { Emitters, type EmitterKind } from './emitters';

const QMUL: Record<Quality, number> = { low: 0.45, medium: 0.7, high: 1, ultra: 1.25 };

// scratch
const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _dirs = [
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0),
];
const _col = new THREE.Color();

function basis(n: THREE.Vector3) {
  _t1.set(0, 1, 0);
  if (Math.abs(n.y) > 0.9) _t1.set(1, 0, 0);
  _t1.cross(n).normalize();
  _t2.crossVectors(n, _t1);
}

/** Random direction within `spread` radians of the (unit) axis set by basis(); written to _d. */
function cone(n: THREE.Vector3, spread: number) {
  const th = spread * Math.sqrt(Math.random());
  const ph = Math.random() * Math.PI * 2;
  const s = Math.sin(th);
  _d.copy(n).multiplyScalar(Math.cos(th))
    .addScaledVector(_t1, Math.cos(ph) * s)
    .addScaledVector(_t2, Math.sin(ph) * s);
  return _d;
}

const r = (a: number, b: number) => a + (b - a) * Math.random();

export interface FxStats { streaks: number; puffs: number; debris: number; emitters: number }

export async function createFx(ctx: GameContext): Promise<FxSystem & { stats(): FxStats; clearDecals(): void }> {
  const root = new THREE.Group();
  root.name = 'fx';
  ctx.scene.add(root);

  const pixelScale = { value: 600 };
  const streaks = new Streaks(4096, pixelScale);
  const atlas = createPuffAtlas(256);
  const puffs = new Puffs(1536, atlas, streaks.planes);
  const flashes = new Flashes(ctx.render.lights, 5);
  const decals = new Decals(ctx.materials);
  const arcs = new Arcs(pixelScale);
  const debris = new Debris(ctx.materials, ctx.scene);
  root.add(puffs.mesh, streaks.mesh, arcs.mesh, decals.root, debris.root);
  // warm-up: everything visible for render.prepare()/first frame so shaders compile at load
  decals.warm(true); debris.warm(true); arcs.mesh.visible = true;
  let warmed = false;

  streaks.gravity = ctx.physics.gravity * 0.55; // sparks / droplets read better slightly floaty vs. player gravity

  const qmul = () => QMUL[ctx.render?.quality ?? 'high'] ?? 1;

  // ── collision helpers
  /** Floor plane below p (one raycast). Returns plane index or -1. */
  function floorPlane(p: THREE.Vector3, maxDist = 8): number {
    _q.copy(p); _q.y += 0.05;
    const hit = ctx.physics.raycast(_q, _down, maxDist);
    if (hit) return streaks.planes.add(hit.normal.x, hit.normal.y, hit.normal.z, hit.point.x, hit.point.y, hit.point.z);
    if (p.y > -0.01) return streaks.planes.add(0, 1, 0, 0, 0, 0); // main floor fallback (y = 0)
    return -1;
  }

  // ── decal rate limiting (token buckets)
  let fluidTokens = 4;

  streaks.onLand = (type, x, y, z, nx, ny, nz, speed) => {
    const S = streaks.s;
    if (type === ST.SPARK) {
      // secondary mini sparks on first hot bounce
      if (Math.random() > 0.55) return;
      const pl = streaks.hitPlane;
      _n.set(nx, ny, nz); basis(_n);
      const k = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < k; i++) {
        resetStreak(ST.MINI);
        cone(_n, 1.2);
        const sp = speed * r(0.2, 0.45);
        S.px = x; S.py = y; S.pz = z; S.vx = _d.x * sp; S.vy = _d.y * sp; S.vz = _d.z * sp;
        S.life = r(0.12, 0.3); S.size = r(0.0028, 0.0045); S.heat = r(0.6, 0.85); S.drag = 1.5; S.rest = 0.3;
        S.planeA = pl;
        streaks.spawn();
      }
      return;
    }
    if (type === ST.DROP) {
      const pl = streaks.hitPlane;
      const k = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < k; i++) {
        resetStreak(ST.SPLASH);
        const a = Math.random() * Math.PI * 2, lat = r(0.2, 0.7);
        S.px = x; S.py = y + 0.004; S.pz = z;
        S.vx = Math.cos(a) * lat; S.vy = r(0.6, 1.4); S.vz = Math.sin(a) * lat;
        S.life = 0.6; S.size = r(0.0016, 0.003); S.r = 0.3; S.g = 0.34; S.b = 0.36; S.alpha = 0.9;
        S.planeA = pl;
        streaks.spawn();
      }
      return;
    }
    if (type === ST.OIL || type === ST.BLOOD) {
      if (fluidTokens < 1 || speed < 0.5) return;
      fluidTokens -= 1;
      _p.set(x, y, z); _n.set(nx, ny, nz);
      const vertical = Math.abs(ny) < 0.5;
      const name: DecalName = type === ST.BLOOD ? (vertical ? 'blood_smear' : 'blood_splat') : (vertical ? 'oil_drip' : 'oil_stain');
      decals.place(name, _p, _n, vertical ? r(0.22, 0.4) : r(0.1, 0.28), vertical ? NaN : Math.random() * 6.283);
    }
  };

  function resetStreak(type: number) {
    const S = streaks.s;
    S.type = type; S.vx = S.vy = S.vz = 0; S.life = 1; S.size = 0.006; S.r = S.g = S.b = 1; S.alpha = 1;
    S.drag = 0.5; S.grav = 1; S.rest = 0.3; S.heat = 1; S.planeA = -1; S.planeB = -1; S.age0 = 0;
  }
  function resetPuff(shape: number) {
    const P = puffs.s;
    P.shape = shape; P.vx = P.vy = P.vz = 0; P.delay = 0; P.life = 1; P.s0 = 0.1; P.s1 = 0.5;
    P.rot = Math.random() * 6.283; P.rotV = r(-0.6, 0.6); P.alpha = 0.4; P.emit = 0; P.emitDecay = 3;
    P.r = P.g = P.b = 0.5; P.drag = 1; P.buoy = 0; P.er0 = 0; P.er1 = 0.5; P.phase = 0.3; P.fadeIn = 0.12; P.grow = 2.2; P.fadePow = 1.3; P.planeA = -1; P.planeB = -1;
  }

  /** Hot point glow (additive flare). */
  function glow(p: THREE.Vector3, size: number, emit: number, life: number, cr: number, cg: number, cb: number) {
    resetPuff(SHAPE.GLOW);
    const P = puffs.s;
    P.px = p.x; P.py = p.y; P.pz = p.z; P.s0 = size; P.s1 = size * 1.3; P.life = life; P.emit = emit;
    P.r = cr; P.g = cg; P.b = cb; P.fadeIn = 0.01; P.rotV = 0;
    puffs.spawn();
  }

  // ── sparks
  function sparksImpl(point: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number, surfacePlane: boolean, spread = 1.15, floor = -2) {
    _n.copy(normal);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0); else _n.normalize();
    basis(_n);
    const pa = surfacePlane ? streaks.planes.add(_n.x, _n.y, _n.z, point.x, point.y, point.z) : -1;
    const pb = floor !== -2 ? floor : (surfacePlane && _n.y > 0.7 ? -1 : floorPlane(point));
    const n = Math.max(1, Math.round(count * qmul()));
    const S = streaks.s;
    for (let i = 0; i < n; i++) {
      resetStreak(ST.SPARK);
      cone(_n, spread);
      const sp = speed * (0.2 + 0.8 * Math.pow(Math.random(), 0.7));
      const off = Math.random() * 0.01;
      S.px = point.x + _n.x * 0.01 + _d.x * off; S.py = point.y + _n.y * 0.01 + _d.y * off; S.pz = point.z + _n.z * 0.01 + _d.z * off;
      S.vx = _d.x * sp; S.vy = _d.y * sp; S.vz = _d.z * sp;
      S.life = r(0.3, 1.0) * (0.6 + 0.4 * sp / Math.max(speed, 0.01));
      S.size = r(0.0045, 0.0085);
      S.heat = r(0.8, 1.0);
      S.drag = r(0.9, 2.0);
      S.rest = r(0.3, 0.5);
      S.planeA = pa; S.planeB = pb;
      streaks.spawn();
    }
    // a couple of slow fat embers that linger
    for (let i = 0; i < Math.min(3, n >> 3); i++) {
      resetStreak(ST.SPARK);
      cone(_n, 0.9);
      const sp = speed * r(0.1, 0.3);
      S.px = point.x; S.py = point.y; S.pz = point.z;
      S.vx = _d.x * sp; S.vy = _d.y * sp + 0.5; S.vz = _d.z * sp;
      S.life = r(0.8, 1.6); S.size = r(0.008, 0.012); S.heat = 0.75; S.drag = 2.5; S.grav = 0.6; S.rest = 0.25;
      S.planeA = pa; S.planeB = pb;
      streaks.spawn();
    }
    _p.copy(point).addScaledVector(_n, 0.02);
    glow(_p, 0.05 + 0.004 * Math.min(count, 40), 6, 0.08, 1.0, 0.55, 0.2);
  }

  // ── smoke
  function smokeImpl(point: THREE.Vector3, count: number, size: number, color: THREE.Color, rise: number, life: number, alpha = 0.32, spread = 1, vel: THREE.Vector3 | null = null, velAmt = 0, pa = -1, pb = -1) {
    const n = Math.max(1, Math.round(count * Math.min(1, qmul() + 0.2)));
    const P = puffs.s;
    for (let i = 0; i < n; i++) {
      resetPuff(SHAPE.SMOKE);
      P.px = point.x + (Math.random() - 0.5) * size * 0.5 * spread;
      P.py = point.y + (Math.random() - 0.5) * size * 0.4 * spread;
      P.pz = point.z + (Math.random() - 0.5) * size * 0.5 * spread;
      P.vx = (Math.random() - 0.5) * size * 0.5; P.vy = rise * r(0.3, 0.7); P.vz = (Math.random() - 0.5) * size * 0.5;
      if (vel) { const k = velAmt * r(0.4, 1.2); P.vx += vel.x * k; P.vy += vel.y * k; P.vz += vel.z * k; }
      P.life = life * r(0.7, 1.2); P.s0 = size * r(0.3, 0.5); P.s1 = size * r(1.1, 1.6);
      P.alpha = alpha * r(0.7, 1.1); P.drag = vel ? 3.5 : 1.2; P.buoy = rise * 0.25;
      const v = r(0.85, 1.1);
      P.r = color.r * v; P.g = color.g * v; P.b = color.b * v;
      P.er0 = 0.05; P.er1 = 0.6; P.phase = 0.3; P.fadeIn = 0.08;
      P.planeA = pa; P.planeB = pb;
      puffs.spawn();
    }
  }

  /** Directional impact dust: a fast cone of small eroding puffs that spreads and slows. */
  function dustBurst(point: THREE.Vector3, n: THREE.Vector3, count: number, size: number, color: THREE.Color, alpha: number, speed: number, pa: number) {
    basis(n);
    const P = puffs.s;
    const k = Math.max(1, Math.round(count * Math.min(1, qmul() + 0.3)));
    for (let i = 0; i < k; i++) {
      resetPuff(SHAPE.SMOKE);
      cone(n, 0.5);
      const sp = speed * r(0.3, 1.0);
      P.px = point.x + n.x * 0.03; P.py = point.y + n.y * 0.03; P.pz = point.z + n.z * 0.03;
      P.vx = _d.x * sp; P.vy = _d.y * sp + 0.1; P.vz = _d.z * sp;
      P.life = r(0.8, 1.6); P.s0 = size * 0.12; P.s1 = size * r(0.7, 1.2); P.grow = 1.6;
      P.alpha = alpha * r(0.6, 1); P.fadePow = 1.8; P.drag = r(4, 6); P.buoy = 0.08;
      const v = r(0.85, 1.1);
      P.r = color.r * v; P.g = color.g * v; P.b = color.b * v;
      P.er0 = 0.15; P.er1 = 0.8; P.phase = 0.35; P.fadeIn = 0.04; P.planeA = pa;
      puffs.spawn();
    }
  }

  // ── fluid
  function fluidImpl(point: THREE.Vector3, direction: THREE.Vector3, count: number, blood: boolean) {
    _n.copy(direction);
    if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0); else _n.normalize();
    _q.copy(point).addScaledVector(_n, 0.03); // don't hit the surface we start on
    const hit = ctx.physics.raycast(_q, _n, 5);
    const pa = hit ? streaks.planes.add(hit.normal.x, hit.normal.y, hit.normal.z, hit.point.x, hit.point.y, hit.point.z) : -1;
    const pb = hit && hit.normal.y > 0.7 ? -1 : floorPlane(point);
    basis(_n);
    const n = Math.max(1, Math.round(count * Math.min(1, qmul() + 0.2)));
    const S = streaks.s;
    fluidTokens = Math.min(fluidTokens + 1, 5);
    for (let i = 0; i < n; i++) {
      resetStreak(blood ? ST.BLOOD : ST.OIL);
      cone(_n, 0.55);
      const sp = r(1.2, 4.5);
      S.px = point.x; S.py = point.y; S.pz = point.z;
      S.vx = _d.x * sp; S.vy = _d.y * sp + r(0, 1); S.vz = _d.z * sp;
      S.life = 2.5; S.size = r(0.005, 0.014);
      if (blood) { S.r = 0.22; S.g = 0.012; S.b = 0.01; } else { S.r = 0.022; S.g = 0.018; S.b = 0.014; }
      S.drag = 0.4; S.planeA = pa; S.planeB = pb;
      streaks.spawn();
    }
    // fine mist
    _col.setRGB(blood ? 0.2 : 0.05, blood ? 0.02 : 0.045, blood ? 0.02 : 0.04);
    smokeImpl(point, 2, 0.12, _col, 0.05, 0.5, 0.28, 0.5, _n, 1.2, pa);
  }

  // ── impacts by surface
  let flashBudget = 1;
  const _dust = new THREE.Color();
  function impact(point: THREE.Vector3, normal: THREE.Vector3, surface: Surface) {
    _n.copy(normal).normalize();
    const S = streaks.s;
    const sp = streaks.planes.add(_n.x, _n.y, _n.z, point.x, point.y, point.z);
    const spawnChips = (k: number, cr: number, cg: number, cb: number, glass: boolean) => {
      basis(_n);
      const pa = sp;
      const pb = _n.y > 0.7 ? -1 : floorPlane(point);
      for (let i = 0; i < k; i++) {
        resetStreak(glass ? ST.GLASS : ST.CHIP);
        cone(_n, 0.9);
        const sp = r(1.5, 5);
        S.px = point.x + _n.x * 0.01; S.py = point.y + _n.y * 0.01; S.pz = point.z + _n.z * 0.01;
        S.vx = _d.x * sp; S.vy = _d.y * sp; S.vz = _d.z * sp;
        S.life = r(0.6, 1.4); S.size = r(0.003, 0.007); S.r = cr; S.g = cg; S.b = cb; S.drag = 0.8; S.rest = 0.3;
        S.planeA = pa; S.planeB = pb;
        streaks.spawn();
      }
    };
    switch (surface) {
      case 'metal':
      case 'robot': {
        sparksImpl(point, _n, r(8, 16), r(4.5, 7.5), true, 1.05);
        decals.place('bullet_metal', point, normal, r(0.06, 0.09));
        _dust.setRGB(0.42, 0.42, 0.43);
        _n.copy(normal).normalize();
        dustBurst(point, _n, 3, 0.22, _dust, 0.22, 2.2, sp);
        if (surface === 'robot') fluidImpl(point, normal, 3, false);
        if (flashBudget >= 1) { flashBudget = 0; _p.copy(point).addScaledVector(normal, 0.1); flashes.fire(_p, 0xffb070, 2.5, 0.06, 3); }
        break;
      }
      case 'concrete': {
        decals.place('bullet_concrete', point, normal, r(0.08, 0.12));
        _dust.setRGB(0.5, 0.47, 0.43);
        dustBurst(point, _n, 6, 0.35, _dust, 0.42, 3.2, sp);
        smokeImpl(point, 1, 0.3, _dust, 0.1, 2.2, 0.15, 0.5, _n, 0.5, sp);
        _n.copy(normal).normalize();
        spawnChips(6, 0.35, 0.33, 0.3, false);
        if (Math.random() < 0.35) sparksImpl(point, _n, 2, 4, true, 0.8);
        break;
      }
      case 'glass': {
        decals.place('bullet_metal', point, normal, r(0.04, 0.06));
        spawnChips(10, 0.55, 0.62, 0.65, true);
        _dust.setRGB(0.55, 0.58, 0.6);
        dustBurst(point, _n, 2, 0.15, _dust, 0.12, 1.5, sp);
        break;
      }
      case 'rubber': {
        decals.place('bullet_concrete', point, normal, r(0.05, 0.07));
        _dust.setRGB(0.12, 0.12, 0.12);
        dustBurst(point, _n, 3, 0.18, _dust, 0.3, 1.8, sp);
        spawnChips(3, 0.05, 0.05, 0.05, false);
        break;
      }
      case 'flesh': {
        decals.place('blood_splat', point, normal, r(0.12, 0.25));
        fluidImpl(point, normal, 6, true);
        break;
      }
    }
  }

  ctx.events.on('bullet:impact', (e) => impact(e.point, e.normal, e.surface));

  // ── arcs
  const arcTick = (s: ArcSlot, dt: number) => {
    // light roams along the bolt
    _p.lerpVectors(s.a, s.b, Math.random());
    flashes.move(s.light, _p);
    s.sparkTimer -= dt;
    if (s.sparkTimer <= 0) {
      s.sparkTimer = r(0.06, 0.22);
      const end = Math.random() < 0.5 ? s.a : s.b, other = end === s.a ? s.b : s.a;
      _q.subVectors(end, other).normalize();
      sparksImpl(end, _q, r(3, 9), r(2.5, 5), false, 1.4);
      glow(end, 0.12, 5, 0.06, 0.5, 0.8, 1.4);
    }
  };

  // ── emitters
  const emitters = new Emitters({
    ctx, streaks, puffs, resetStreak, resetPuff, sparks: sparksImpl, glow, floorPlane,
    flash: (p, c, i, d, dist) => { flashes.fire(p, c, i, d, dist); },
    arc: (a, b, d) => fx.arc(a, b, d),
    decal: (name, p, n, size) => decals.place(name, p, n, size),
    qmul,
  });

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();

  const fx = {
    sparks(point: THREE.Vector3, normal: THREE.Vector3, count = 20, speed = 6) {
      sparksImpl(point, normal, count, speed, true);
      if (count >= 12 && flashBudget >= 1) {
        flashBudget = 0;
        _p.copy(point).addScaledVector(normal, 0.1);
        flashes.fire(_p, 0xffb36a, Math.min(10, count * 0.18), 0.08, 4);
      }
    },

    smoke(point: THREE.Vector3, opts: { count?: number; size?: number; color?: THREE.ColorRepresentation; rise?: number; life?: number } = {}) {
      _col.set(opts.color ?? 0x8e8f90);
      smokeImpl(point, opts.count ?? 6, opts.size ?? 0.5, _col, opts.rise ?? 0.4, opts.life ?? 2.5, 0.32, 1, null, 0, floorPlane(point));
    },

    fluid(point: THREE.Vector3, direction: THREE.Vector3, count = 10) {
      fluidImpl(point, direction, count, false);
    },

    decal(name: DecalName, point: THREE.Vector3, normal: THREE.Vector3, size = 0.3) {
      const vertical = Math.abs(normal.y) < 0.5;
      const upright = vertical && (name === 'oil_drip' || name === 'blood_smear' || name === 'water_stain' || name === 'handprint');
      decals.place(name, point, normal, size, upright ? NaN : Math.random() * Math.PI * 2);
    },

    flash(point: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, duration: number, distance = 6) {
      flashes.fire(point, color, intensity, duration, distance);
    },

    arc(a: THREE.Vector3, b: THREE.Vector3, duration = 0.6) {
      const s = arcs.start(a, b, duration);
      _p.lerpVectors(a, b, 0.5);
      s.light = flashes.fire(_p, 0x8fd0ff, 7, duration, 6, 1);
      _q.subVectors(a, b).normalize();
      sparksImpl(a, _q, 12, 5, false, 1.3);
      _q.negate();
      sparksImpl(b, _q, 12, 5, false, 1.3);
    },

    explosion(point: THREE.Vector3, scale = 1) {
      const s = scale;
      _p.copy(point);
      // surroundings first: floor + nearest wall become collision planes, nearest surface gets the scorch
      let best: { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null = null;
      let floorPl = -1, wallPl = -1, ceilPl = -1, wallDist = Infinity;
      for (const dir of _dirs) {
        const h = ctx.physics.raycast(_p, dir, 3 * s);
        if (!h) continue;
        if (!best || h.distance < best.distance * (dir.y < 0 ? 1.4 : 1)) best = h;
        if (dir.y < 0) floorPl = streaks.planes.add(h.normal.x, h.normal.y, h.normal.z, h.point.x, h.point.y, h.point.z);
        else if (dir.y > 0) ceilPl = streaks.planes.add(h.normal.x, h.normal.y, h.normal.z, h.point.x, h.point.y, h.point.z);
        else if (dir.y === 0 && h.distance < wallDist) {
          wallDist = h.distance;
          wallPl = streaks.planes.add(h.normal.x, h.normal.y, h.normal.z, h.point.x, h.point.y, h.point.z);
        }
      }
      if (floorPl < 0 && _p.y > -0.01 && _p.y < 3 * s) floorPl = streaks.planes.add(0, 1, 0, 0, 0, 0);
      if (best && best.distance < 2.5 * s) decals.place('scorch', best.point, best.normal, r(2.0, 2.6) * s);
      else if (_p.y < 2.5 * s && _p.y > -0.01) { _q.set(_p.x, 0, _p.z); decals.place('scorch', _q, _up, 2.2 * s); }

      flashes.fire(_p, 0xff9248, 70 * s * s, 0.6 + 0.25 * s, 12 * s);
      glow(_p, 1.3 * s, 3.2, 0.14, 1.0, 0.6, 0.3);
      // shockwave
      resetPuff(SHAPE.RING);
      const P = puffs.s;
      P.px = _p.x; P.py = _p.y; P.pz = _p.z; P.s0 = 0.3 * s; P.s1 = 4.0 * s; P.life = 0.3; P.emit = 1.1;
      P.r = 1.0; P.g = 0.78; P.b = 0.55; P.fadeIn = 0.01; P.rotV = 0;
      puffs.spawn();
      // fireball: hot puffs that cool into thick smoke
      const nf = Math.round(28 * Math.min(1.5, s) * Math.min(1, qmul() + 0.3));
      for (let i = 0; i < nf; i++) {
        resetPuff(SHAPE.SMOKE);
        _d.set(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize();
        const sp = r(2, 6) * s;
        P.px = _p.x + _d.x * 0.15 * s; P.py = _p.y + _d.y * 0.15 * s; P.pz = _p.z + _d.z * 0.15 * s;
        P.vx = _d.x * sp; P.vy = _d.y * sp + 0.6; P.vz = _d.z * sp;
        P.life = r(1.8, 3.2) * Math.sqrt(s); P.s0 = r(0.15, 0.35) * s; P.s1 = r(0.7, 1.3) * s;
        P.alpha = r(0.55, 0.8); P.emit = r(2.0, 2.8); P.emitDecay = r(2.4, 3.6); P.delay = Math.random() * 0.06;
        P.r = P.g = P.b = r(0.06, 0.1); P.drag = 3.2; P.buoy = 0.9; P.er0 = 0; P.er1 = 0.55; P.phase = 0.2; P.fadeIn = 0.03;
        P.rotV = r(-1.5, 1.5); P.planeA = floorPl; P.planeB = wallPl;
        puffs.spawn();
      }
      // lingering smoke column
      for (let i = 0; i < Math.round(10 * Math.min(1.5, s)); i++) {
        resetPuff(SHAPE.SMOKE);
        P.px = _p.x + (Math.random() - 0.5) * s; P.py = _p.y + Math.random() * 0.4 * s; P.pz = _p.z + (Math.random() - 0.5) * s;
        P.vx = (Math.random() - 0.5) * 0.6 * s; P.vy = r(0.3, 0.9); P.vz = (Math.random() - 0.5) * 0.6 * s;
        P.delay = r(0.15, 0.6); P.life = r(4, 7); P.s0 = 0.5 * s; P.s1 = r(1.8, 2.6) * s; P.alpha = r(0.25, 0.4);
        P.r = P.g = P.b = r(0.12, 0.18); P.drag = 1; P.buoy = 0.25; P.er0 = 0.05; P.er1 = 0.6; P.fadeIn = 0.2;
        P.planeA = ceilPl >= 0 ? ceilPl : floorPl; P.planeB = wallPl;
        puffs.spawn();
      }
      // sparks everywhere
      _q.set(0, 1, 0);
      sparksImpl(_p, _q, 70 * s, 11 * Math.sqrt(s), false, Math.PI * 0.95, floorPl);
      // shards
      for (let i = 0; i < Math.round(4 * Math.min(2, s)); i++) {
        _d.set(Math.random() - 0.5, r(0.3, 1), Math.random() - 0.5).normalize().multiplyScalar(r(4, 9) * Math.sqrt(s));
        _q.copy(_p).addScaledVector(_d, 0.03);
        debris.spawnShard(_q, _d, r(5, 9));
      }
      // camera shake by distance
      const pl = ctx.player;
      if (pl && pl.shake) {
        const dist = pl.eye ? pl.eye.distanceTo(_p) : 10;
        pl.shake(Math.min(1, (1.3 * s) / (1 + dist * 0.3)));
      }
    },

    debris(point: THREE.Vector3, impulse: THREE.Vector3, meshes?: THREE.Object3D[], life = 6) {
      const mag = impulse.length();
      if (meshes && meshes.length) {
        for (const m of meshes) {
          _d.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(Math.max(1, mag * 0.5)).add(impulse);
          debris.spawnObject(m, _d, life);
        }
        return;
      }
      const n = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        _d.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(Math.max(1.5, mag * 0.5));
        _d.addScaledVector(impulse, r(0.6, 1.2));
        _q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12).add(point);
        debris.spawnShard(_q, _d, life * r(0.8, 1.2));
      }
    },

    emitter(kind: EmitterKind, point: THREE.Vector3, direction?: THREE.Vector3, rate?: number) {
      return emitters.add(kind, point, direction, rate);
    },

    update(dt: number) {
      if (!warmed) { warmed = true; decals.warm(false); debris.warm(false); arcs.mesh.visible = false; }
      const cam = ctx.camera;
      const h = ctx.renderer?.domElement?.height || innerHeight;
      pixelScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
      fluidTokens = Math.min(5, fluidTokens + dt * 10);
      flashBudget = Math.min(1, flashBudget + dt * 12);

      cam.updateMatrixWorld();
      cam.getWorldPosition(flashes.cam);
      projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      emitters.update(dt, cam, frustum);

      arcs.update(dt, arcTick);
      flashes.update(dt);
      debris.update(dt, ctx.physics);
      streaks.update(dt);
      puffs.update(dt, cam);
    },

    stats(): FxStats {
      return { streaks: streaks.count, puffs: puffs.count, debris: debris.activeCount, emitters: emitters.count };
    },
    clearDecals() { decals.clear(); },
  };

  debris.onImpact = (p, n, speed) => {
    if (Math.random() < 0.3) sparksImpl(p, n, Math.min(6, speed), 2.5, true, 1.2);
    try { if (speed > 4 && Math.random() < 0.5) ctx.audio?.play('metal_clang', { position: p, volume: Math.min(0.5, speed * 0.06) }); } catch { /* audio optional */ }
  };

  return fx;
}
