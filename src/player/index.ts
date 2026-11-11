/**
 * PLAYER module: movement, camera feel, flashlight, weapons + procedural viewmodels, pickups, health.
 * Public surface = `Player` from core/types plus a few extras (`revive`, `debug`, `viewmodel`).
 */
import * as THREE from 'three';
import type { GameContext, Interactable, PickupKind, Player, Surface, WeaponId, WeaponState } from '../core/types';
import { Controller, MOVE, type MoveInput } from './controller';
import { CameraRig } from './camera';
import { Flashlight } from './flashlight';
import { Weapons, WEAPON_STATS, type WeaponInput, type Aim } from './weapons';
import { Pickups } from './pickups';
import { Viewmodel, type RigMotion } from './viewmodels/rig';
import { resolveMats } from './viewmodels/mats';
import { setVmLight } from './viewmodels/vmlight';
import { clamp, damp, wrapAngle } from './math';

const SENSITIVITY = 0.0022;
const PITCH_LIMIT = THREE.MathUtils.degToRad(88);
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export interface PlayerExtras {
  revive(health?: number): void;
  readonly viewmodel: Viewmodel;
  readonly pickups: Pickups;
  debug: Record<string, (...a: any[]) => any>;
}

export async function createPlayer(ctx: GameContext): Promise<Player & PlayerExtras> {
  const spawn = ctx.debug.spawn ?? { position: ctx.level.spawn.position, yaw: ctx.level.spawn.yaw, pitch: 0 };
  const mats = resolveMats(ctx.materials, true); // first-person set (private clones with the viewmodel light)
  const worldMats = resolveMats(ctx.materials);   // same models out in the world: pickups, brass, dropped mags
  const ctrl = new Controller(ctx.physics, spawn.position);
  const camRig = new CameraRig(ctx.camera);
  const flash = new Flashlight(ctx.render.lights, ctx.physics);
  const vm = new Viewmodel(mats, ctx.render.viewmodelLayer);
  ctx.camera.add(vm.root);
  const weapons = new Weapons(ctx, vm, camRig, worldMats);
  const keys = new Set<string>();

  // state
  const eye = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  let yaw = spawn.yaw, pitch = spawn.pitch;
  let health = 100;
  const maxHealth = 100;
  let alive = true;
  let focus: Interactable | null = null;
  let hitMarker = 0;
  let controlsEnabled = true;
  let time = 0;
  let wallT = 0;
  let wallCheck = 0;
  let lastLookX = 0, lastLookY = 0;
  let noSprintT = 0;
  let dbgFire = false, dbgReload = false;
  let dbgSlot: WeaponId | null = null;
  const dbgMove = { fwd: 0, strafe: 0, sprint: false, jump: false, crouch: false };
  // scripted look
  const look = { active: false, t: 0, dur: 1, y0: 0, p0: 0, y1: 0, p1: 0 };

  weapons.onHit = () => { hitMarker = 1; };

  // The story flips state to 'dead' on player:died, which stops main-loop updates; keep the
  // collapse animating with a private rAF loop while the main loop isn't ticking us.
  let lastMainUpdate = 0;
  function startDeathLoop() {
    let last = performance.now();
    const t0 = last;
    const tick = (now: number) => {
      if (alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now - lastMainUpdate > 60) deathTick(dt);
      if (now - t0 < 2500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function deathTick(dt: number) {
    time += dt;
    camRig.update(dt, {
      eye, yaw, pitch, bobPhase: ctrl.bobPhase, bobAmp: 0, sprint: 0, crouch: ctrl.crouchBlend,
      eyeHeight: ctrl.eyeHeight, strafe: 0, time,
    });
    weapons.lower = Math.min(1, weapons.lower + dt * 1.5);
    motion.time = time; motion.lookX = 0; motion.lookY = 0; motion.speed = 0; motion.lower = weapons.lower;
    vm.update(dt, motion);
    flash.update(dt, ctx.camera.position, ctx.camera.quaternion, forward, 0, 0);
  }

  const ev = {
    footstep(running: boolean) {
      const p = ctrl.body.position;
      const o = new THREE.Vector3(p.x, p.y + 0.3, p.z);
      const hit = ctx.physics.raycast(o, DOWN, 0.7);
      const surface: Surface = hit ? hit.surface : 'metal';
      ctx.events.emit('player:footstep', { position: p.clone(), surface, running });
    },
    land(speed: number) {
      camRig.land(speed);
      vm.bump(-Math.min(1.2, 0.25 + speed * 0.08));
      ctx.events.emit('player:land', { speed });
      if (speed > 3) ev.footstep(false);
    },
    jump() {
      camRig.jump();
      vm.bump(0.35);
      ctx.events.emit('player:jump', {});
    },
  };

  const moveIn: MoveInput = { fwd: 0, strafe: 0, sprint: false, jump: false, crouchToggle: false, crouchHold: false, noSprint: false };
  const wIn: WeaponInput = { firePressed: false, fireHeld: false, reload: false, slot: null, wheel: 0 };
  const aim: Aim = { origin: eye, forward, right, up, moving: 0, airborne: false, crouched: false };
  const motion: RigMotion = { time: 0, lookX: 0, lookY: 0, speed: 0, bobPhase: 0, grounded: true, vy: 0, sprint: 0, crouch: 0, wall: 0, lower: 1, strafe: 0 };
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();

  const pickups = new Pickups(ctx, worldMats, {
    wants(kind: PickupKind) {
      switch (kind) {
        case 'medkit': return alive && health < maxHealth;
        case 'ammo_pistol': return !weapons.ammoFull('pistol');
        case 'ammo_shotgun': return !weapons.ammoFull('shotgun');
        default: return true;
      }
    },
    give: (kind, amount) => player.give(kind, amount),
    addKey: (k) => keys.add(k),
  });
  for (const sp of ctx.level.pickupSpawns) pickups.spawn(sp);

  function computeBasis() {
    _e.set(pitch + camRig.kickPitch.x, yaw + camRig.kickYaw.x, 0, 'YXZ');
    _q.setFromEuler(_e);
    forward.set(0, 0, -1).applyQuaternion(_q);
    right.set(1, 0, 0).applyQuaternion(_q);
    up.set(0, 1, 0).applyQuaternion(_q);
  }

  function lowHealthAmount() { return clamp((55 - health) / 45, 0, 1); }

  const player: Player & PlayerExtras = {
    get position() { return ctrl.body.position; },
    eye,
    forward,
    get velocity() { return ctrl.body.velocity; },
    get yaw() { return yaw; },
    set yaw(v: number) { yaw = v; },
    get pitch() { return pitch; },
    set pitch(v: number) { pitch = clamp(v, -PITCH_LIMIT, PITCH_LIMIT); },
    get health() { return health; },
    set health(v: number) { health = clamp(v, 0, maxHealth); ctx.render.post.setLowHealth(lowHealthAmount()); },
    maxHealth,
    get alive() { return alive; },
    get controlsEnabled() { return controlsEnabled; },
    set controlsEnabled(v: boolean) { controlsEnabled = v; },
    get flashlightOn() { return flash.on; },
    get weapons(): Record<WeaponId, WeaponState> { return weapons.states; },
    get currentWeapon() { return weapons.current; },
    get focus() { return focus; },
    get hitMarker() { return hitMarker; },
    keys,
    viewmodel: vm,
    pickups,

    damage(amount: number, from?: THREE.Vector3) {
      if (!alive || ctx.debug.god || amount <= 0) return;
      health = Math.max(0, health - amount);
      ctx.events.emit('player:damaged', { amount, health, from: from ? from.clone() : null });
      ctx.render.post.damage(clamp(amount / 35, 0.25, 1));
      ctx.render.post.setLowHealth(lowHealthAmount());
      let side = 0, front = 0;
      if (from) {
        const dx = from.x - eye.x, dz = from.z - eye.z;
        const l = Math.hypot(dx, dz) || 1;
        const s = Math.sin(yaw), c = Math.cos(yaw);
        side = (dx * c - dz * s) / l; // + = from the right
        front = (-dx * s - dz * c) / l; // + = from the front
      }
      camRig.damage(side, front, amount);
      if (health <= 0) {
        alive = false;
        weapons.holster();
        camRig.die();
        ctx.render.post.setLowHealth(1);
        ctx.events.emit('player:died', {});
        startDeathLoop();
      }
    },
    heal(amount: number) {
      if (!alive || amount <= 0) return;
      const before = health;
      health = Math.min(maxHealth, health + amount);
      ctx.events.emit('player:healed', { amount: health - before, health });
      ctx.render.post.setLowHealth(lowHealthAmount());
    },
    give(kind: PickupKind, amount: number) {
      switch (kind) {
        case 'pistol': weapons.give('pistol', amount); break;
        case 'shotgun': weapons.give('shotgun', amount); break;
        case 'ammo_pistol': weapons.addAmmo('pistol', amount || 12); break;
        case 'ammo_shotgun': weapons.addAmmo('shotgun', amount || 6); break;
        case 'medkit': player.heal(amount || 40); break;
        case 'keycard': keys.add('keycard'); break;
      }
    },
    hasKey: (k: string) => keys.has(k),
    addKey: (k: string) => { keys.add(k); },
    teleport(p: THREE.Vector3, y?: number, pi?: number) {
      ctrl.teleport(p);
      if (y !== undefined) yaw = y;
      if (pi !== undefined) pitch = clamp(pi, -PITCH_LIMIT, PITCH_LIMIT);
      look.active = false;
    },
    shake(a: number) { camRig.shake(a); },
    lookAt(point: THREE.Vector3, seconds: number) {
      const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
      look.y0 = yaw; look.p0 = pitch;
      look.y1 = yaw + wrapAngle(Math.atan2(-dx, -dz) - yaw);
      look.p1 = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_LIMIT, PITCH_LIMIT);
      look.t = 0; look.dur = Math.max(0.001, seconds); look.active = true;
    },
    revive(h = maxHealth) {
      alive = true; health = h; camRig.revive();
      ctx.render.post.setLowHealth(lowHealthAmount());
      const last = weapons.states.shotgun.owned && weapons.current === null ? null : null;
      void last;
      const id = (['shotgun', 'pistol'] as WeaponId[]).find((w) => weapons.states[w].owned) ?? null;
      if (id) weapons.switchTo(id, true);
    },

    update(dt: number) {
      lastMainUpdate = performance.now();
      time += dt;
      const inp = ctx.input;
      const active = controlsEnabled && alive && ctx.state === 'playing';

      // ── look
      lastLookX = 0; lastLookY = 0;
      if (active) {
        const dx = inp.mouseDX * SENSITIVITY, dy = inp.mouseDY * SENSITIVITY;
        if (dx || dy) { look.active = false; }
        yaw -= dx;
        const np = clamp(pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
        lastLookY = np - pitch; lastLookX = -dx;
        pitch = np;
      }
      if (look.active && dt > 0) {
        look.t = Math.min(1, look.t + dt / look.dur);
        const k = look.t * look.t * (3 - 2 * look.t);
        const ny = look.y0 + (look.y1 - look.y0) * k, np = look.p0 + (look.p1 - look.p0) * k;
        lastLookX = ny - yaw; lastLookY = np - pitch;
        yaw = ny; pitch = np;
        if (look.t >= 1) look.active = false;
      }
      yaw = wrapAngle(yaw);

      // ── movement
      noSprintT = Math.max(0, noSprintT - dt);
      if (active) {
        const f = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0) + dbgMove.fwd;
        const s = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0) + dbgMove.strafe;
        moveIn.fwd = clamp(f, -1, 1); moveIn.strafe = clamp(s, -1, 1);
        moveIn.sprint = inp.down('ShiftLeft') || inp.down('ShiftRight') || dbgMove.sprint;
        moveIn.jump = inp.pressed('Space') || dbgMove.jump;
        moveIn.crouchToggle = inp.pressed('KeyC');
        moveIn.crouchHold = dbgMove.crouch; // crouch is C only: Ctrl+W would close the tab mid-fight
        moveIn.noSprint = noSprintT > 0 || weapons.reloading || weapons.firedRecently > 0;
        dbgMove.jump = false;
      }
      ctrl.update(dt, active ? moveIn : null, yaw, ev);
      const feet = ctrl.body.position;
      eye.set(feet.x, feet.y + ctrl.eyeHeight, feet.z);

      // ── camera
      const bobAmp = ctrl.grounded ? clamp(ctrl.speed / MOVE.walk, 0, 1.4) : 0;
      camRig.update(dt, {
        eye, yaw, pitch, bobPhase: ctrl.bobPhase, bobAmp, sprint: ctrl.sprintBlend, crouch: ctrl.crouchBlend,
        eyeHeight: ctrl.eyeHeight, strafe: ctrl.strafeSpeed, time,
      });
      ctx.camera.updateMatrixWorld();
      computeBasis();

      // ── wall proximity (viewmodel pull-back), throttled
      wallCheck -= dt;
      if (wallCheck <= 0) {
        wallCheck = 0.05;
        const hit = ctx.physics.raycast(eye, forward, 0.95);
        wallT = hit ? clamp((0.95 - hit.distance) / 0.6, 0, 1) : 0;
      }

      // ── weapons
      if (active) {
        wIn.firePressed = inp.mousePressed(0) || dbgFire;
        wIn.fireHeld = inp.mouseDown(0);
        wIn.reload = inp.pressed('KeyR') || dbgReload;
        wIn.slot = inp.pressed('Digit1') ? 'pistol' : inp.pressed('Digit2') ? 'shotgun' : dbgSlot;
        wIn.wheel = inp.wheel;
        if (wIn.firePressed && ctrl.sprinting) noSprintT = 0.4;
        dbgFire = false; dbgReload = false; dbgSlot = null;
      }
      aim.moving = clamp(ctrl.speed / MOVE.sprint, 0, 1);
      aim.airborne = !ctrl.grounded;
      aim.crouched = ctrl.crouched;
      weapons.update(dt, active ? wIn : null, aim, ctrl.sprintBlend);
      if (!alive) weapons.lower = Math.min(1, weapons.lower + dt * 1.5);

      // ── viewmodel
      motion.time = time;
      motion.lookX = lastLookX; motion.lookY = lastLookY;
      motion.speed = clamp(ctrl.speed / MOVE.sprint, 0, 1) * (ctrl.grounded ? 1 : 0);
      motion.bobPhase = ctrl.bobPhase;
      motion.grounded = ctrl.grounded;
      motion.vy = ctrl.body.velocity.y;
      motion.sprint = ctrl.sprintBlend;
      motion.crouch = ctrl.crouchBlend;
      motion.wall = wallT;
      motion.lower = weapons.lower;
      motion.strafe = clamp(ctrl.strafeSpeed / MOVE.walk, -1, 1);
      vm.update(dt, motion);
      vm.pistol.lf.setLevel(health / maxHealth);
      vm.shotgun.lf.setLevel(health / maxHealth);
      mats.wristLed.emissive.setHex(health > 30 ? 0x30e0ff : 0xff3020);

      // ── flashlight
      if (active && inp.pressed('KeyF')) {
        flash.set(!flash.on);
        ctx.events.emit('player:flashlight', { on: flash.on });
      }
      const sway = ctrl.grounded ? Math.min(1, ctrl.speed / MOVE.walk) : 0;
      flash.update(dt, ctx.camera.position, ctx.camera.quaternion, forward,
        Math.sin(ctrl.bobPhase) * 0.012 * sway, -Math.abs(Math.cos(ctrl.bobPhase)) * 0.008 * sway);
      setVmLight(flash.level);

      // ── interaction
      focus = alive ? ctx.interactables.pick(eye, forward) : null;
      if (active && focus && inp.pressed('KeyE')) ctx.interactables.use(focus);

      // ── pickups + HUD state
      pickups.update(dt, time, feet, alive);
      hitMarker = Math.max(0, hitMarker - dt * 3.5);
      void damp; void UP;
    },

    debug: {},
  };

  player.debug = {
    fire: () => { dbgFire = true; return weapons.current; },
    reload: () => { dbgReload = true; return weapons.current; },
    switchTo: (id: WeaponId) => { dbgSlot = id; return id; },
    move: (fwd = 0, strafe = 0, sprint = false) => { dbgMove.fwd = fwd; dbgMove.strafe = strafe; dbgMove.sprint = sprint; },
    jump: () => { dbgMove.jump = true; },
    crouch: (on = true) => { dbgMove.crouch = on; },
    flashlight: (on = true) => { flash.set(on); ctx.events.emit('player:flashlight', { on }); return on; },
    spawnPickup: (kind: PickupKind, x: number, y: number, z: number, amount = 10) => pickups.add(kind, new THREE.Vector3(x, y, z), amount),
    state: () => ({
      pos: ctrl.body.position.toArray().map((v) => +v.toFixed(3)), vel: ctrl.body.velocity.toArray().map((v) => +v.toFixed(2)),
      grounded: ctrl.grounded, crouched: ctrl.crouched, eyeHeight: +ctrl.eyeHeight.toFixed(3), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
      health, alive, weapon: weapons.current, weapons: JSON.parse(JSON.stringify(weapons.states)), flashlight: flash.on,
      focus: focus?.id ?? null, lower: +weapons.lower.toFixed(2), clip: vm.active?.player.name ?? '',
    }),
    setPose: (id: 'pistol' | 'shotgun', x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
      (id === 'pistol' ? vm.pistol : vm.shotgun).setBase(x, y, z, rx, ry, rz),
    stats: () => WEAPON_STATS,
    /** Slow tracers down for inspection (default 190 m/s). */
    tracerSpeed: (v = 190) => { weapons.tracers.speed = v; return v; },
    tracers: () => ({ visible: weapons.tracers.mesh.visible, count: weapons.tracers.mesh.geometry.drawRange.count / 6, layer: weapons.tracers.mesh.layers.mask }),
    grips: () => ({ pistol: vm.pistol.report, shotgun: vm.shotgun.report }),
  };

  if (ctx.debug.giveAll) {
    weapons.give('shotgun', 36);
    weapons.give('pistol', 96);
    weapons.lower = 0;
  }
  ctx.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  return player;
}
