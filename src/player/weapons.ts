/**
 * Weapon logic: ammo, fire rate, spread, hitscan (enemies vs world, nearest wins), reload state
 * machines (pistol mag swap, shotgun per-shell loop that firing interrupts), switching, and the
 * per-shot effects (muzzle light, smoke, brass, recoil, noise). Drives the viewmodel rigs.
 */
import * as THREE from 'three';
import type { GameContext, WeaponId, WeaponState } from '../core/types';
import type { Viewmodel } from './viewmodels/rig';
import type { CameraRig } from './camera';
import { PISTOL_CLIPS, SHOTGUN_CLIPS } from './viewmodels/clips';
import { buildCasingGeo, buildSpentShellParts } from './viewmodels/props';
import { buildMagazine } from './viewmodels/pistol';
import type { VmMats } from './viewmodels/mats';
import { clamp } from './math';
import { Tracers } from './tracers';
import { setVmRoom } from './viewmodels/vmlight';

export const WEAPON_STATS = {
  pistol: { clipSize: 12, damage: 20, interval: 0.14, range: 90, baseSpread: 0.0025, bloom: 0.011, noise: 30, maxReserve: 96, light: 70 },
  shotgun: { clipSize: 6, damage: 9, pellets: 9, interval: 0.25, range: 45, cone: 0.062, noise: 42, maxReserve: 36, light: 140 },
} as const;

export interface WeaponInput {
  firePressed: boolean;
  fireHeld: boolean;
  reload: boolean;
  slot: WeaponId | null;
  wheel: number;
}

export interface Aim {
  origin: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** 0..1 movement inaccuracy */
  moving: number;
  airborne: boolean;
  crouched: boolean;
}

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _end = new THREE.Vector3();
// fixed 9-pellet pattern (unit disc) — jittered per shot
const PATTERN: [number, number][] = [[0, 0], [0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55], [0.75, 0.62], [-0.75, 0.62], [0.72, -0.66], [-0.72, -0.66]];

export class Weapons {
  readonly states: Record<WeaponId, WeaponState> = {
    pistol: { id: 'pistol', owned: false, clip: 0, clipSize: WEAPON_STATS.pistol.clipSize, reserve: 0, reloading: false },
    shotgun: { id: 'shotgun', owned: false, clip: 0, clipSize: WEAPON_STATS.shotgun.clipSize, reserve: 0, reloading: false },
  };
  current: WeaponId | null = null;
  private pending: WeaponId | null = null;
  /** 0 = raised, 1 = fully lowered. */
  lower = 1;
  private phase: 'idle' | 'lowering' | 'raising' = 'idle';
  private cooldown = 0;
  private bloom = 0;
  private emptyClicked = false;
  private shotgunInterrupt = false;
  private shotgunRack = false;
  private fireQueued = 0;
  /** Seconds the player recently fired (blocks sprint). */
  firedRecently = 0;
  onHit: (amount: number) => void = () => {};

  private casings: THREE.Mesh[] = [];
  private casingI = 0;
  private hulls: THREE.Object3D[] = [];
  private hullI = 0;
  private mags: THREE.Object3D[] = [];
  private magI = 0;
  readonly tracers: Tracers;

  constructor(private ctx: GameContext, private vm: Viewmodel, private cam: CameraRig, m: VmMats) {
    const cg = buildCasingGeo();
    cg.computeBoundingSphere();
    for (let i = 0; i < 48; i++) {
      const c = new THREE.Mesh(cg, m.brass);
      c.castShadow = true; c.receiveShadow = true;
      this.casings.push(c);
    }
    const hullProto = buildSpentShellParts(m);
    for (let i = 0; i < 44; i++) {
      const h = hullProto.clone();
      h.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      this.hulls.push(h);
    }
    for (let i = 0; i < 6; i++) {
      const g = buildMagazine(m, false);
      g.traverse((o) => { o.castShadow = true; });
      this.mags.push(g);
    }
    this.tracers = new Tracers(ctx.scene);
    vm.pistol.onEvent = (id) => this.pistolEvent(id);
    vm.shotgun.onEvent = (id) => this.shotgunEvent(id);
  }

  get reloading() { return this.current ? this.states[this.current].reloading : false; }
  get switching() { return this.phase !== 'idle'; }

  /** Own a weapon (full clip when newly acquired) and add reserve ammo. Auto-equips new weapons. */
  give(id: WeaponId, reserve: number) {
    const s = this.states[id];
    const fresh = !s.owned;
    s.owned = true;
    if (fresh) s.clip = s.clipSize;
    s.reserve = Math.min(WEAPON_STATS[id].maxReserve, s.reserve + Math.max(0, reserve));
    if (fresh) this.switchTo(id, true);
    this.syncSaddle();
  }

  /** Returns how many rounds were accepted. */
  addAmmo(id: WeaponId, n: number): number {
    const s = this.states[id];
    const room = WEAPON_STATS[id].maxReserve - s.reserve;
    const k = Math.max(0, Math.min(room, n));
    s.reserve += k;
    this.syncSaddle();
    return k;
  }

  ammoFull(id: WeaponId) { return this.states[id].reserve >= WEAPON_STATS[id].maxReserve; }

  switchTo(id: WeaponId | null, force = false) {
    if (id && !this.states[id].owned) return;
    if (id === this.current && !force) return;
    if (id === this.current && this.phase === 'idle') return;
    this.cancelReload();
    this.pending = id;
    this.phase = this.current ? 'lowering' : 'raising';
    if (!this.current) this.equipPending();
  }

  private equipPending() {
    this.current = this.pending;
    this.pending = null;
    this.vm.setActive(this.current);
    this.phase = this.current ? 'raising' : 'idle';
    if (this.current) {
      this.ctx.events.emit('weapon:switched', { weapon: this.current });
      if (this.current === 'pistol') this.vm.pistol.slideLocked = this.states.pistol.clip === 0;
    }
  }

  cancelReload() {
    for (const id of ['pistol', 'shotgun'] as const) {
      if (!this.states[id].reloading) continue;
      this.states[id].reloading = false;
      (id === 'pistol' ? this.vm.pistol : this.vm.shotgun).cancel();
    }
  }

  /**
   * REVISION 6.1: both hands off the weapon for a moment (palm scan). While stowed the weapon is held lowered and
   * takes no input; a reload is cancelled. Un-stowing raises it again.
   */
  private stowed = false;
  setStowed(on: boolean) {
    if (on === this.stowed) return;
    this.stowed = on;
    if (on) { this.cancelReload(); this.fireQueued = 0; }
    else if (this.phase !== 'lowering') this.phase = this.current ? 'raising' : 'idle';
  }

  /** Holster everything (death). */
  holster() { this.cancelReload(); this.phase = 'lowering'; this.pending = null; }

  reload() {
    const id = this.current;
    if (!id || this.phase !== 'idle') return;
    const s = this.states[id];
    if (s.reloading || s.clip >= s.clipSize || s.reserve <= 0) return;
    if (id === 'pistol') {
      const empty = s.clip === 0;
      s.reloading = true;
      const clip = empty ? PISTOL_CLIPS.reloadEmpty : PISTOL_CLIPS.reload;
      this.ctx.events.emit('weapon:reload', { weapon: 'pistol', duration: clip.dur });
      this.vm.pistol.reload(empty, () => { s.reloading = false; });
    } else {
      const rig = this.vm.shotgun;
      if (rig.busy) return;
      s.reloading = true;
      this.shotgunInterrupt = false;
      this.shotgunRack = s.clip === 0;
      rig.play(SHOTGUN_CLIPS.reloadEnter, () => this.shotgunInsertLoop());
    }
  }

  private shotgunInsertLoop() {
    const s = this.states.shotgun;
    if (!s.reloading) return;
    const rig = this.vm.shotgun;
    if (this.shotgunInterrupt || s.clip >= s.clipSize || s.reserve <= 0) {
      const hurry = this.shotgunInterrupt;
      const finish = () => {
        s.reloading = false;
        // the shot that interrupted the reload goes off as soon as the gun is back up
        if (this.shotgunInterrupt && s.clip > 0) this.fireQueued = 0.2;
      };
      rig.play(SHOTGUN_CLIPS.reloadExit, () => {
        if (this.shotgunRack && s.clip > 0) {
          this.shotgunRack = false;
          rig.play(SHOTGUN_CLIPS.rack, finish);
        } else finish();
      });
      if (hurry) rig.player.speed = 1.45;
      return;
    }
    // one insert per event (< 0.8 s) — audio plays one shell per weapon:reload
    this.ctx.events.emit('weapon:reload', { weapon: 'shotgun', duration: SHOTGUN_CLIPS.reloadInsert.dur });
    rig.play(SHOTGUN_CLIPS.reloadInsert, () => this.shotgunInsertLoop());
    // hands are not a metronome: each shell takes a slightly different beat
    rig.player.speed = 0.95 + Math.random() * 0.12;
  }

  /**
   * Fire pressed mid-reload: break off from wherever the hands are. A shell already in the fingers is pushed home
   * (fast); otherwise the insert is abandoned right away. The rig cross-fades the support hand, the gun is on
   * springs, so there is no pop from any point.
   */
  private interruptShotgunReload() {
    if (this.shotgunInterrupt) return;
    this.shotgunInterrupt = true;
    const rig = this.vm.shotgun;
    const name = rig.player.name;
    if (name === 'reloadInsert') {
      if (rig.holding) rig.player.speed = 1.7;
      else if (rig.player.t < 0.145 || rig.player.t > 0.42) this.shotgunInsertLoop();
    } else if (name === 'reloadEnter') {
      this.shotgunInsertLoop();
    }
  }

  private pistolEvent(id: string) {
    const s = this.states.pistol;
    if (id === 'magIn') {
      const need = s.clipSize - s.clip;
      const k = Math.min(need, s.reserve);
      s.clip += k; s.reserve -= k;
    } else if (id === 'magDrop') {
      // the old magazine falls into the world
      const mag = this.mags[this.magI++ % this.mags.length];
      const src = this.vm.pistol.model.mag;
      src.updateWorldMatrix(true, false);
      src.matrixWorld.decompose(mag.position, mag.quaternion, mag.scale);
      mag.scale.set(1, 1, 1);
      mag.layers.set(0);
      _imp.set(0, -1.2, 0).addScaledVector(this.aimCache.forward, 0.4);
      this.ctx.fx.debris(mag.position, _imp, [mag], 8);
    }
  }

  private shotgunEvent(id: string) {
    const s = this.states.shotgun;
    if (id === 'shellIn') {
      if (s.reserve > 0 && s.clip < s.clipSize) { s.clip++; s.reserve--; }
      this.syncSaddle();
    } else if (id === 'eject') {
      this.ejectBrass(true);
    }
  }

  private syncSaddle() { this.vm.shotgun.saddleCount = Math.min(4, this.states.shotgun.reserve); }

  private readonly aimCache = { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) };

  private ejectBrass(shell: boolean) {
    const rig = shell ? this.vm.shotgun : this.vm.pistol;
    rig.ejectWorld(_p);
    const a = this.aimCache;
    _imp.set(0, 0, 0)
      .addScaledVector(a.right, shell ? 1.9 : 2.3 + Math.random() * 0.6)
      .addScaledVector(a.up, shell ? 1.3 : 1.9 + Math.random() * 0.5)
      .addScaledVector(a.forward, -0.4);
    let obj: THREE.Object3D;
    if (shell) obj = this.hulls[this.hullI++ % this.hulls.length];
    else obj = this.casings[this.casingI++ % this.casings.length];
    obj.position.copy(_p);
    obj.quaternion.setFromAxisAngle(a.forward, Math.PI / 2);
    obj.layers.set(0);
    this.ctx.fx.debris(_p, _imp, [obj], 7);
  }

  update(dt: number, inp: WeaponInput | null, aim: Aim, sprintBlend: number) {
    this.aimCache.forward.copy(aim.forward);
    this.aimCache.right.copy(aim.right);
    this.aimCache.up.copy(aim.up);
    this.cooldown -= dt;
    this.fireQueued = Math.max(0, this.fireQueued - dt);
    this.firedRecently = Math.max(0, this.firedRecently - dt);
    this.bloom *= Math.exp(-dt * 5);
    this.tracers.update(dt, this.ctx.camera.position);
    this.sampleRoomLight(dt);
    // eyes follow the hands: the playing clip's glance rides on the camera's kick springs (aim moves with it)
    const gl = this.vm.active?.glance;
    this.cam.kickPitch.target = gl ? gl.x : 0;
    this.cam.kickYaw.target = gl ? gl.y : 0;

    // stowed (palm scan): held down; a switch that was under way still completes out of sight
    if (this.stowed) {
      this.lower = Math.min(1, this.lower + dt / 0.2);
      if (this.phase === 'lowering' && this.lower >= 1) {
        if (this.pending) this.equipPending();
        else { this.current = null; this.vm.setActive(null); this.phase = 'idle'; }
      }
      return;
    }
    // switching animation
    if (this.phase === 'lowering') {
      this.lower = Math.min(1, this.lower + dt / 0.22);
      if (this.lower >= 1) {
        if (this.pending) this.equipPending();
        else { this.current = null; this.vm.setActive(null); this.phase = 'idle'; }
      }
    } else if (this.phase === 'raising') {
      this.lower = Math.max(0, this.lower - dt / 0.34);
      if (this.lower <= 0) this.phase = 'idle';
    }

    if (!inp) return;
    // selection
    if (inp.slot && inp.slot !== this.current) this.switchTo(inp.slot);
    if (inp.wheel !== 0) {
      const order: WeaponId[] = ['pistol', 'shotgun'];
      const owned = order.filter((w) => this.states[w].owned);
      if (owned.length > 1) {
        const i = Math.max(0, owned.indexOf(this.pending ?? this.current ?? owned[0]));
        this.switchTo(owned[(i + (inp.wheel > 0 ? 1 : owned.length - 1)) % owned.length]);
      }
    }
    const id = this.current;
    if (!id) return;
    const s = this.states[id];
    if (inp.reload) this.reload();

    if (inp.firePressed) this.fireQueued = 0.18;
    const wantFire = this.fireQueued > 0;
    if (!wantFire) return;
    this.firedRecently = 0.35;
    if (sprintBlend > 0.35) return; // lowering out of sprint first
    if (this.phase === 'raising' && this.lower > 0.3) return;
    if (this.phase === 'lowering') return;

    if (id === 'shotgun' && s.reloading) {
      this.interruptShotgunReload();
      return;
    }
    if (s.reloading || this.cooldown > 0) return;
    if (id === 'shotgun' && this.vm.shotgun.busy) return;

    this.fireQueued = 0;
    if (s.clip <= 0) {
      this.ctx.events.emit('weapon:empty', { weapon: id });
      if (this.emptyClicked && s.reserve > 0) { this.emptyClicked = false; this.reload(); }
      else this.emptyClicked = true;
      this.cooldown = 0.2;
      return;
    }
    this.emptyClicked = false;
    this.fire(id, aim);
  }

  private fire(id: WeaponId, aim: Aim) {
    const s = this.states[id];
    s.clip--;
    const ctx = this.ctx;
    const origin = aim.origin;
    if (id === 'pistol') {
      const st = WEAPON_STATS.pistol;
      this.cooldown = st.interval;
      const spread = (st.baseSpread + aim.moving * 0.018 + (aim.airborne ? 0.03 : 0) + this.bloom) * (aim.crouched ? 0.7 : 1);
      this.bloom = Math.min(0.05, this.bloom + st.bloom);
      this.spreadDir(aim, spread, Math.random() * 2 - 1, Math.random() * 2 - 1, _d);
      this.vm.pistol.muzzleWorld(_muz);
      _end.copy(origin).addScaledVector(_d, this.ray(origin, _d, st.range, st.damage));
      this.tracers.spawn(_muz, _end, 0.014, 7, 4.2, 1.8);
      this.vm.pistol.fire(s.clip === 0);
      this.cam.kick(1.1 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5);
      this.cam.shake(0.08);
      ctx.events.emit('weapon:fired', { weapon: 'pistol', origin: origin.clone(), direction: _d.clone() });
      this.ejectBrass(false);
    } else {
      const st = WEAPON_STATS.shotgun;
      this.cooldown = st.interval;
      const cone = st.cone * (aim.crouched ? 0.9 : 1) + aim.moving * 0.01;
      const rot = Math.random() * Math.PI * 2;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      this.vm.shotgun.muzzleWorld(_muz);
      for (let i = 0; i < st.pellets; i++) {
        const [px, py] = PATTERN[i];
        const jx = px + (Math.random() - 0.5) * 0.35, jy = py + (Math.random() - 0.5) * 0.35;
        this.spreadDir(aim, cone, jx * cr - jy * sr, jx * sr + jy * cr, _d, true);
        _end.copy(origin).addScaledVector(_d, this.ray(origin, _d, st.range, st.damage));
        this.tracers.spawn(_muz, _end, 0.011, 3.6, 2.3, 1.1);
      }
      this.vm.shotgun.fire(() => {});
      this.cam.kick(3.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
      this.cam.shake(0.32);
      ctx.events.emit('weapon:fired', { weapon: 'shotgun', origin: origin.clone(), direction: aim.forward.clone() });
    }
    ctx.enemies?.alertNoise(origin, WEAPON_STATS[id].noise);
    // muzzle light + smoke
    const rig = id === 'pistol' ? this.vm.pistol : this.vm.shotgun;
    rig.muzzleWorld(_p);
    ctx.fx.flash(_p, id === 'pistol' ? 0xffb366 : 0xffa04d, WEAPON_STATS[id].light, id === 'pistol' ? 0.05 : 0.065, id === 'pistol' ? 7 : 10);
    _p.addScaledVector(aim.forward, 0.05);
    ctx.fx.smoke(_p, { count: id === 'pistol' ? 2 : 5, size: id === 'pistol' ? 0.08 : 0.16, color: 0x8a8580, rise: 0.25, life: id === 'pistol' ? 1.1 : 1.8 });
  }

  /** Direction inside a cone: (ox, oy) in the unit disc (or square if !disc) scaled by `spread` radians. */
  private spreadDir(aim: Aim, spread: number, ox: number, oy: number, out: THREE.Vector3, disc = false) {
    if (!disc) { const l = Math.hypot(ox, oy); if (l > 1) { ox /= l; oy /= l; } }
    out.copy(aim.forward).addScaledVector(aim.right, ox * spread).addScaledVector(aim.up, oy * spread).normalize();
    return out;
  }

  /** Hitscan one projectile; returns the distance it travelled (to the hit, or the full range). */
  private ray(origin: THREE.Vector3, dir: THREE.Vector3, range: number, dmg: number): number {
    const ctx = this.ctx;
    const eh = ctx.enemies ? ctx.enemies.hitscan(origin, dir, range) : null;
    const wh = ctx.physics.raycast(origin, dir, range);
    if (eh && (!wh || eh.distance <= wh.distance)) {
      ctx.enemies.damage(eh, dmg, dir.clone());
      this.onHit(dmg);
      return eh.distance;
    } else if (wh) {
      ctx.events.emit('bullet:impact', { point: wh.point, normal: wh.normal, surface: wh.surface, owner: wh.owner });
      return wh.distance;
    }
    return range;
  }

  // ── room light on the viewmodel (5 Hz, smoothed): what the pooled lights do to the surfaces around the player
  // (probe points on the floor ahead, to both sides and overhead → the bounce the hands would pick up) and what
  // reaches the hands directly.
  private poolLights: (THREE.PointLight | THREE.SpotLight)[] | null = null;
  private roomT = 0;
  private readonly roomRGB = new THREE.Color(0, 0, 0);
  private roomDirect = 0;
  private readonly probes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** three's punctual falloff (+ spot cone) of light `l` at `p`, per unit colour. */
  private lightAt(l: THREE.PointLight | THREE.SpotLight, lp: THREE.Vector3, p: THREE.Vector3): number {
    const d = lp.distanceTo(p);
    if (l.distance > 0 && d >= l.distance) return 0;
    let e = l.intensity / Math.max(d * d, 0.25);
    if (l.distance > 0) { const w = 1 - Math.pow(d / l.distance, 4); e *= w * w; }
    const sp = l as THREE.SpotLight;
    if (sp.isSpotLight) {
      _p.setFromMatrixPosition(sp.target.matrixWorld).sub(lp).normalize();
      const c = (_p.x * (p.x - lp.x) + _p.y * (p.y - lp.y) + _p.z * (p.z - lp.z)) / Math.max(d, 1e-4);
      const c0 = Math.cos(sp.angle), c1 = Math.cos(sp.angle * (1 - sp.penumbra));
      e *= clamp((c - c0) / Math.max(1e-4, c1 - c0), 0, 1);
    }
    return e;
  }
  private sampleRoomLight(dt: number) {
    this.roomT -= dt;
    if (this.roomT <= 0) {
      this.roomT = 0.2;
      if (!this.poolLights || this.poolLights.length === 0) {
        const list: (THREE.PointLight | THREE.SpotLight)[] = [];
        this.ctx.scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight || (o as THREE.SpotLight).isSpotLight) list.push(o as THREE.PointLight); });
        this.poolLights = list;
      }
      const eye = this.ctx.camera.position, a = this.aimCache, P = this.probes;
      const fl = Math.hypot(a.forward.x, a.forward.z) || 1, fx = a.forward.x / fl, fz = a.forward.z / fl;
      P[0].set(eye.x + fx * 1.2, eye.y - 1.55, eye.z + fz * 1.2);
      P[1].set(eye.x + fx * 3.6, eye.y - 1.55, eye.z + fz * 3.6);
      P[2].set(eye.x - fz * 2 + fx, eye.y - 0.6, eye.z + fx * 2 + fz);
      P[3].set(eye.x + fz * 2 + fx, eye.y - 0.6, eye.z - fx * 2 + fz);
      P[4].set(eye.x + fx * 1.5, eye.y + 1.1, eye.z + fz * 1.5);
      P[5].set(eye.x - fx * 1.5, eye.y - 1.55, eye.z - fz * 1.5);
      let r = 0, g = 0, b = 0, direct = 0;
      for (const l of this.poolLights) {
        if (!l.visible || l.intensity <= 0) continue;
        _end.setFromMatrixPosition(l.matrixWorld);
        const d = _end.distanceTo(eye);
        // the player's own lamp and muzzle flashes light the gun for real; they are not "the room"
        if (d < 0.9 || d > 40) continue;
        let env = 0;
        for (let i = 0; i < P.length; i++) env += this.lightAt(l, _end, P[i]);
        env *= 0.5 / P.length;
        let e = this.lightAt(l, _end, eye);
        if (e > 0.03) {
          // behind a wall: nothing direct
          _d.copy(_end).sub(eye).multiplyScalar(1 / d);
          if (this.ctx.physics.raycast(eye, _d, d - 0.25)) e = 0;
        }
        // (direct light already colours the hands through the real BRDF — only the bounce feeds the fill's hue)
        r += l.color.r * env; g += l.color.g * env; b += l.color.b * env;
        direct += e;
      }
      this.roomRGB.setRGB(r, g, b);
      this.roomDirect = direct;
    }
    setVmRoom(this.roomRGB.r, this.roomRGB.g, this.roomRGB.b, this.roomDirect, 1 - Math.exp(-dt * 3.5));
  }

  /** Debug helpers. */
  debugFire(): boolean {
    const id = this.current;
    if (!id) return false;
    this.fireQueued = 0.2;
    return true;
  }
}

