/** Continuous emitters: steam jets, sparking cables, drips, floating dust motes. Distance/frustum throttled. */
import * as THREE from 'three';
import type { DecalName, GameContext } from '../core/types';
import type { Streaks } from './streaks';
import { ST } from './streaks';
import type { Puffs } from './puffs';
import { SHAPE } from './puffs';

export type EmitterKind = 'steam' | 'sparks' | 'drip' | 'dust';

export interface EmitterDeps {
  ctx: GameContext;
  streaks: Streaks;
  puffs: Puffs;
  resetStreak(type: number): void;
  resetPuff(shape: number): void;
  sparks(point: THREE.Vector3, normal: THREE.Vector3, count: number, speed: number, surfacePlane: boolean, spread?: number, floor?: number): void;
  glow(p: THREE.Vector3, size: number, emit: number, life: number, r: number, g: number, b: number): void;
  floorPlane(p: THREE.Vector3, maxDist?: number): number;
  flash(p: THREE.Vector3, c: THREE.ColorRepresentation, intensity: number, duration: number, distance: number): void;
  arc(a: THREE.Vector3, b: THREE.Vector3, duration: number): void;
  decal(name: DecalName, p: THREE.Vector3, n: THREE.Vector3, size: number): void;
  qmul(): number;
}

/** Where an emitter's particles go: the global pools, or a bounded set's own instances (stage 3b §8.6.3). */
export interface EmitterSink { puffs: Puffs; streaks: Streaks }

interface Em {
  kind: EmitterKind;
  sink: EmitterSink;
  /** Jet speed multiplier (steam). */
  speed: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  rate: number;
  acc: number;
  timer: number;
  t: number;
  seed: number;
  /** floor plane (point + normal) cached at creation */
  floor: THREE.Plane | null;
  floorY: number;
  /** plane above (ceiling) for smoke, cached at creation */
  ceil: THREE.Plane | null;
  /** dust: volume half extents, estimated live count */
  ext: THREE.Vector3;
  est: number;
  handle: { stop(): void; enabled: boolean };
  dead: boolean;
}

const sphere = new THREE.Sphere();
const camPos = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const r = (a: number, b: number) => a + (b - a) * Math.random();

export class Emitters {
  private list: Em[] = [];
  constructor(private d: EmitterDeps) {}

  get count() { return this.list.length; }

  add(kind: EmitterKind, point: THREE.Vector3, direction?: THREE.Vector3, rate?: number, sink?: EmitterSink, speed = 1) {
    const dir = new THREE.Vector3();
    if (kind === 'dust') dir.set(0, 1, 0);
    else if (direction && direction.lengthSq() > 1e-8) dir.copy(direction).normalize();
    else dir.set(0, kind === 'steam' ? 1 : -1, 0);
    const t1 = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) t1.set(1, 0, 0);
    t1.cross(dir).normalize();
    const t2 = new THREE.Vector3().crossVectors(dir, t1);
    const em: Em = {
      kind, speed, sink: sink ?? { puffs: this.d.puffs, streaks: this.d.streaks }, pos: point.clone(), dir, t1, t2,
      rate: rate ?? (kind === 'steam' ? 70 : kind === 'sparks' ? 0.7 : kind === 'drip' ? 0.8 : 60),
      acc: 0, timer: Math.random() * 0.5, t: 0, seed: Math.random() * 100,
      floor: null, floorY: 0, ceil: null,
      ext: kind === 'dust' && direction ? new THREE.Vector3(Math.abs(direction.x) || 3, Math.abs(direction.y) || 1.5, Math.abs(direction.z) || 3) : new THREE.Vector3(3, 1.4, 3),
      est: 0,
      handle: null as any, dead: false,
    };
    em.handle = { enabled: true, stop: () => { em.dead = true; } };
    if (kind === 'drip' || kind === 'sparks') {
      _q.copy(point); _q.y -= 0.01; // emitters often sit flush against a ceiling: start just below it
      const hit = this.d.ctx.physics.raycast(_q, new THREE.Vector3(0, -1, 0), 20);
      if (hit) { em.floor = new THREE.Plane().setFromNormalAndCoplanarPoint(hit.normal, hit.point); em.floorY = hit.point.y; }
      else { em.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); em.floorY = 0; }
      if (kind === 'sparks') {
        const up = this.d.ctx.physics.raycast(point, new THREE.Vector3(0, 1, 0), 3);
        if (up) em.ceil = new THREE.Plane().setFromNormalAndCoplanarPoint(up.normal, up.point);
      }
      if (kind === 'drip' && hit) this.d.decal('water_stain', hit.point, hit.normal, r(0.35, 0.6));
    }
    this.list.push(em);
    return em.handle;
  }

  update(dt: number, cam: THREE.Camera, frustum: THREE.Frustum) {
    if (dt <= 0) return;
    cam.getWorldPosition(camPos);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const em = this.list[i];
      if (em.dead) { this.list.splice(i, 1); continue; }
      if (!em.handle.enabled) continue;
      em.t += dt;
      const dist = camPos.distanceTo(em.pos);
      if (dist > 25) { if (em.kind === 'dust') em.est *= 1 - dt / 8; continue; }
      sphere.center.copy(em.pos);
      sphere.radius = em.kind === 'dust' ? Math.max(em.ext.x, em.ext.y, em.ext.z) + 0.5 : em.kind === 'steam' ? 2.5 : 1.5;
      if (em.kind === 'steam') sphere.center.addScaledVector(em.dir, 1.2);
      else if ((em.kind === 'drip' || em.kind === 'sparks') && em.floor) {
        // the visible part is the whole fall column down to the floor
        const h = Math.max(0, em.pos.y - em.floorY);
        sphere.center.y -= h * 0.5;
        sphere.radius = Math.max(sphere.radius, h * 0.5 + 0.6);
      }
      const visible = frustum.intersectsSphere(sphere);
      const throttle = (visible ? 1 : 0.15) * (dist > 15 ? 0.5 : 1) * this.d.qmul();
      switch (em.kind) {
        case 'steam': this.steam(em, dt, throttle); break;
        case 'sparks': if (visible || dist < 6) this.sparkBurst(em, dt); break;
        case 'drip': this.drip(em, dt, visible); break;
        case 'dust': this.dust(em, dt, visible); break;
      }
    }
  }

  private steam(em: Em, dt: number, throttle: number) {
    // pressure surges
    const surge = 0.75 + 0.35 * Math.sin(em.t * 1.7 + em.seed) * Math.sin(em.t * 0.63 + em.seed * 2) + 0.15 * Math.random();
    em.acc += em.rate * dt * throttle * surge;
    const P = this.d.puffs.s;
    let n = 0;
    while (em.acc >= 1 && n < 16) {
      em.acc -= 1; n++;
      this.d.resetPuff(SHAPE.SMOKE);
      const a = Math.random() * Math.PI * 2, s = Math.random() * 0.1;
      _n.copy(em.dir).addScaledVector(em.t1, Math.cos(a) * s).addScaledVector(em.t2, Math.sin(a) * s).normalize();
      const sp = r(4, 6.5) * surge * em.speed;
      const back = Math.random() * dt; // sub-frame spread so the jet is continuous
      P.px = em.pos.x + _n.x * (0.03 + sp * back); P.py = em.pos.y + _n.y * (0.03 + sp * back); P.pz = em.pos.z + _n.z * (0.03 + sp * back);
      P.vx = _n.x * sp; P.vy = _n.y * sp; P.vz = _n.z * sp;
      P.life = r(2.0, 3.0); P.s0 = r(0.04, 0.06); P.s1 = r(0.6, 1.1); P.grow = 1.1;
      P.alpha = r(0.12, 0.18); P.fadePow = 2.2; P.drag = r(1.3, 1.6); P.buoy = 0.8;
      const v = r(0.75, 0.9);
      P.r = v; P.g = v * 1.01; P.b = v * 1.04;
      P.er0 = 0.12; P.er1 = 0.75; P.phase = 0.5; P.fadeIn = 0.14; P.rotV = r(-1.4, 1.4);
      em.sink.puffs.spawn(P);
    }
    if (em.acc > 4) em.acc = 4;
  }

  private sparkBurst(em: Em, dt: number) {
    em.timer -= dt;
    if (em.timer > 0) return;
    em.timer = r(0.25, 2.2) / Math.max(0.05, em.rate);
    const big = Math.random() < 0.3;
    const floorIdx = em.floor ? this.d.streaks.planes.add(em.floor.normal.x, em.floor.normal.y, em.floor.normal.z, em.pos.x, em.floorY, em.pos.z) : -1;
    this.d.sparks(em.pos, em.dir, big ? r(25, 45) : r(8, 18), big ? r(3.5, 5.5) : r(2, 4), false, 1.2, floorIdx);
    this.d.flash(em.pos, big ? 0xbfdcff : 0xffc890, big ? r(10, 18) : r(4, 8), big ? 0.12 : 0.07, 5);
    this.d.glow(em.pos, big ? 0.35 : 0.18, 6, 0.08, 0.7, 0.85, 1.4);
    if (big && Math.random() < 0.6) {
      _p.copy(em.pos).addScaledVector(em.dir, 0.15).addScaledVector(em.t1, r(-0.25, 0.25)).addScaledVector(em.t2, r(-0.25, 0.25));
      this.d.arc(em.pos, _p, r(0.08, 0.18));
    }
    if (Math.random() < 0.4) {
      this.d.resetPuff(SHAPE.SMOKE);
      const P = this.d.puffs.s;
      P.px = em.pos.x; P.py = em.pos.y; P.pz = em.pos.z; P.vy = 0.15; P.life = 1.6; P.s0 = 0.05; P.s1 = 0.35;
      P.alpha = 0.15; P.r = P.g = P.b = 0.35; P.drag = 1; P.buoy = 0.15;
      if (em.ceil) P.planeA = this.d.streaks.planes.add(em.ceil.normal.x, em.ceil.normal.y, em.ceil.normal.z, em.pos.x, -em.ceil.constant / (em.ceil.normal.y || 1), em.pos.z);
      this.d.puffs.spawn();
    }
  }

  private drip(em: Em, dt: number, visible: boolean) {
    em.timer -= dt;
    if (em.timer > 0) return;
    em.timer = r(0.6, 1.4) / Math.max(0.05, em.rate);
    if (!visible) return;
    const S = this.d.streaks.s;
    this.d.resetStreak(ST.DROP);
    S.px = em.pos.x; S.py = em.pos.y; S.pz = em.pos.z;
    S.vy = -0.2;
    const h = Math.max(0.1, em.pos.y - em.floorY);
    S.life = Math.sqrt((2 * h) / Math.abs(this.d.streaks.gravity)) + 0.5;
    S.size = r(0.004, 0.006); S.r = 0.25; S.g = 0.28; S.b = 0.3; S.alpha = 0.85; S.drag = 0.05;
    S.planeA = em.floor ? em.sink.streaks.planes.add(em.floor.normal.x, em.floor.normal.y, em.floor.normal.z, em.pos.x, em.floorY, em.pos.z) : -1;
    em.sink.streaks.spawn(S);
  }

  private dust(em: Em, dt: number, visible: boolean) {
    const target = em.rate;
    const life = 9;
    em.est -= (em.est * dt) / life;
    if (!visible) return;
    let need = target * dt / life;
    if (em.est < target * 0.7) need = Math.min(target * 0.7 - em.est, 30); // catch up (prewarm), motes fade in
    em.acc += need;
    const S = this.d.streaks.s;
    let n = 0;
    while (em.acc >= 1 && n < 40) {
      em.acc -= 1; n++; em.est += 1;
      this.d.resetStreak(ST.MOTE);
      S.px = em.pos.x + (Math.random() * 2 - 1) * em.ext.x;
      S.py = em.pos.y + (Math.random() * 2 - 1) * em.ext.y;
      S.pz = em.pos.z + (Math.random() * 2 - 1) * em.ext.z;
      S.vx = r(-0.03, 0.03); S.vy = r(-0.015, 0.02); S.vz = r(-0.03, 0.03);
      S.life = r(6, 12); S.size = r(0.0015, 0.0042);
      const w = r(0.6, 0.9);
      S.r = w; S.g = w * 0.97; S.b = w * 0.92; S.alpha = r(0.6, 1);
      em.sink.streaks.spawn(S);
    }
  }
}
