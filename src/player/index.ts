/**
 * PLAYER module: movement, camera feel, flashlight, weapons + procedural viewmodels, pickups, health.
 * Public surface = `Player` from core/types plus a few extras (`revive`, `debug`, `viewmodel`).
 */
import * as THREE from 'three';
import type { GameContext, Interactable, PalmPlate, PalmResult, PickupKind, Player, PlayerSave, Surface, WeaponId, WeaponState } from '../core/types';
import { WEAPON_IDS } from '../core/types';
import { Controller, MOVE, type MoveInput } from './controller';
import { CameraRig } from './camera';
import { Flashlight } from './flashlight';
import { Weapons, WEAPON_STATS, type WeaponInput, type Aim } from './weapons';
import { Pickups } from './pickups';
import { Viewmodel, type RigMotion } from './viewmodels/rig';
import { resolveMats } from './viewmodels/mats';
import { setVmLight } from './viewmodels/vmlight';
import { clamp, damp, wrapAngle } from './math';
import { PalmHand } from './palm';
import { LOWER_CINEMATIC, LOWER_SAFE, clearJump, settle, standNow } from './cinematic';

const SENSITIVITY = 0.0022;
const PITCH_LIMIT = THREE.MathUtils.degToRad(88);
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export interface PlayerExtras {
  revive(health?: number): void;
  /** Level change: apply a carried loadout (weapons, ammo, health, lamp) — ignores position, keys and pickup ids. */
  applyLoadout(save: Partial<PlayerSave>): void;
  readonly viewmodel: Viewmodel;
  readonly pickups: Pickups;
  /**
   * §8.2: while `cinematic(true)` the camera belongs to the cutscene; the player's own camera feel (breathing, springs,
   * fov) keeps running for the body and its result is published here instead of being written to `ctx.camera`, so a
   * scene can end exactly on the view the player gets on the first interactive frame. Outside a scene: the camera's
   * pose of this frame.
   */
  readonly view: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly fov: number };
  /** §8.2: true while `cinematic(true)` holds. */
  readonly inCinematic: boolean;
  debug: Record<string, (...a: any[]) => any>;
}

/** Armour from a save / carry: finite, 0 … 100 (anything else → 0). */
function cleanArmor(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 100) : 0;
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
  // stage 3b §8.2: armour takes 2/3 of every hit while it lasts
  let armor = 0;
  const maxArmor = 100;
  const ARMOR_SHARE = 2 / 3;
  let alive = true;
  let focus: Interactable | null = null;
  let hitMarker = 0;
  let controlsEnabled = true;
  let time = 0;
  let wallT = 0;
  let wallCheck = 0;
  let lastLookX = 0, lastLookY = 0;
  let noSprintT = 0;
  let dbgFire = false, dbgReload = false, dbgHold = false;
  let dbgSlot: WeaponId | null = null;
  const dbgMove = { fwd: 0, strafe: 0, sprint: false, jump: false, crouch: false };
  // scripted look
  const look = { active: false, t: 0, dur: 1, y0: 0, p0: 0, y1: 0, p1: 0 };

  weapons.onHit = () => { hitMarker = 1; };

  // ── cinematic mode (§8.2), safe state (§8.3), consumed keys ──
  let cine: { vm: 'hidden' | 'lowered' } | null = null;
  let safe = false;
  /** The palm scan's hands-off-the-gun hold (from `palm()` until the hand has left the view). */
  let palmStow = false;
  /** Keys forgotten until released (`consumeKey`): neither `down` nor `pressed` reach movement / weapons. */
  const consumed = new Set<string>();
  const view = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: ctx.camera.fov };
  const _camP = new THREE.Vector3(), _camQ = new THREE.Quaternion();
  /** One owner of the weapon's stow: the strongest reason wins (a scene, the safe state, a palm scan). */
  function syncStow() {
    const level = cine ? (cine.vm === 'hidden' ? 1 : LOWER_CINEMATIC) : safe ? LOWER_SAFE : palmStow || strapStow ? 1 : -1;
    if (level >= 0) weapons.setStowed(true, (palmStow || strapStow) && !cine ? Math.max(level, 1) : level);
    else weapons.setStowed(false);
  }
  const isDown = (c: string) => !consumed.has(c) && ctx.input.down(c);
  const isPressed = (c: string) => !consumed.has(c) && ctx.input.pressed(c);
  const mouseHeld = (b: number) => !consumed.has(`Mouse${b}`) && ctx.input.mouseDown(b);
  const mousePress = (b: number) => !consumed.has(`Mouse${b}`) && ctx.input.mousePressed(b);
  function releaseConsumed() {
    for (const c of consumed) {
      const m = /^Mouse(\d)$/.exec(c);
      if (!(m ? ctx.input.mouseDown(+m[1]) : ctx.input.down(c))) consumed.delete(c);
    }
  }

  // ── palm scan (REVISION 6.1): the free left hand flat on a plate for a moment; see Player.palm ──
  const PALM_START = 1.0, PALM_CANCEL = 1.3;
  /** How much of the mouse still reaches the view while the hand is on the plate, and how hard the view is drawn to it. */
  const PALM_LOOK = 0.15, PALM_PULL = 7;
  let palm: { plate: PalmPlate; dur: number; t: number; pitch0: number; resolve: (r: PalmResult) => void } | null = null;
  let unstowIn = -1;
  let headUp: { by: number; t: number; k: number } | null = null;
  const palmHand = new PalmHand(worldMats);
  ctx.scene.add(palmHand.root);
  const palmDist = (plate: PalmPlate) => { const p = ctrl.body.position; return Math.hypot(p.x - plate.position.x, p.z - plate.position.z); };
  function endPalm(result: PalmResult) {
    const p = palm;
    if (!p) return;
    palm = null;
    if (alive) palmHand.release(result === 'done'); else palmHand.hide();
    // the weapon comes back up as the hand leaves the view
    unstowIn = result === 'done' ? 0.42 : 0.14;
    if (cine) { unstowIn = -1; palmStow = false; syncStow(); }
    // the head comes back up to where it was looking (any mouse movement takes over at once)
    headUp = alive && pitch < p.pitch0 - 0.12 ? { by: p.pitch0 - pitch, t: 0, k: 0 } : null;
    p.resolve(result);
  }
  ctx.events.on('game:state', (e) => { if (palm && e.state !== 'playing') endPalm('cancelled'); });

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

  // R8: an interactable can be focused only if nothing solid lies between the eye and it (0.4 m tolerance (armoury locker pistol sits 0.3 m inside a solid locker box):
  // interactables sit on / slightly inside panels, desks, consoles). Same scoring as InteractableRegistry.pick.
  const LOS_TOL = 0.4;
  const _to = new THREE.Vector3();
  function pickVisible(): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const i of ctx.interactables.all) {
      if (!i.enabled) continue;
      _to.copy(i.position).sub(eye);
      const d = _to.length();
      const r = i.radius ?? 2.2;
      if (d > r) continue;
      const dot = d < 0.001 ? 1 : _to.dot(forward) / d;
      if (dot < (d < 0.9 ? 0.6 : 0.9)) continue;
      const score = dot * 2 - d / r;
      if (score <= bestScore) continue;
      if (d > 0.3 && ctx.physics.raycast(eye, _to.multiplyScalar(1 / d), d - LOS_TOL)) continue;
      bestScore = score; best = i;
    }
    return best;
  }

  const pickups = new Pickups(ctx, worldMats, {
    wants(kind: PickupKind) {
      switch (kind) {
        case 'medkit': return alive && health < maxHealth;
        case 'ammo_pistol': return !weapons.ammoFull('pistol');
        case 'ammo_shotgun': return !weapons.ammoFull('shotgun');
        case 'ammo_carbine': return !weapons.ammoFull('carbine');
        case 'plate': return alive && armor < maxArmor;
        default: return true;
      }
    },
    give: (kind, amount) => player.give(kind, amount),
    addKey: (k) => keys.add(k),
    vest: (take) => startStrap(take),
  });
  for (const sp of ctx.level.pickupSpawns) pickups.spawn(sp);

  // ── vest strap (§8.2): 0.8 s, weapon lowered, walking pace; damage, sprint, jump, a note or a pause cancel it
  const STRAP = 0.8;
  let strap: { t: number; take: () => void } | null = null;
  let strapStow = false;
  function startStrap(take: () => void): boolean {
    if (armor >= maxArmor) { ctx.events.emit('story:toast', { text: 'Armour full' }); return false; }
    if (strap || palm || cine || !alive || !controlsEnabled || ctx.state !== 'playing') return false;
    strap = { t: 0, take };
    strapStow = true;
    syncStow();
    return true;
  }
  function endStrap(done: boolean) {
    const st = strap;
    if (!st) return;
    strap = null;
    strapStow = false;
    syncStow();
    if (done) st.take();
  }
  function noteOpen() { return !!(ctx.ui as unknown as { noteOpen?: boolean } | undefined)?.noteOpen; }

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
    get armor() { return armor; },
    maxArmor,
    addArmor(points: number) {
      if (!(points > 0) || armor >= maxArmor) return 0;
      const before = armor;
      armor = Math.min(maxArmor, armor + points);
      const delta = armor - before;
      if (delta > 0) ctx.events.emit('player:armor', { armor, delta });
      return delta;
    },
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
      // §8.2: a scene plays only with no hostile alive; anything that still lands on the frozen body is dropped
      if (cine) { console.warn(`[player] ${amount} damage during a cinematic ignored`); return; }
      // §8.2: the armour takes 2/3 of the hit while it has points; health takes the rest
      const absorbed = Math.min(armor, amount * ARMOR_SHARE);
      if (absorbed > 0) armor = Math.max(0, armor - absorbed);
      const before = health;
      health = Math.max(0, health - (amount - absorbed));
      const lost = before - health;
      ctx.events.emit('player:damaged', { amount: lost, health, from: from ? from.clone() : null, absorbed, armor });
      if (absorbed > 0) ctx.events.emit('player:armor', { armor, delta: -absorbed });
      if (strap) endStrap(false);
      ctx.render.post.damage(clamp(Math.max(lost, absorbed * 0.35) / 35, 0.25, 1));
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
      if (palm) endPalm('cancelled');
      if (health <= 0) {
        alive = false;
        palmHand.hide();
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
        case 'carbine': weapons.give('carbine', amount); break;
        case 'ammo_carbine': weapons.addAmmo('carbine', amount || 30); break;
        case 'vest': player.addArmor(amount || 50); break;
        case 'plate': player.addArmor(amount || 15); break;
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
      if (palm) endPalm('cancelled');
      headUp = null;
    },
    palm(plate: PalmPlate, seconds: number): Promise<PalmResult> {
      return new Promise<PalmResult>((resolve) => {
        if (palm || cine || !alive || !controlsEnabled || ctx.state !== 'playing') { resolve('refused'); return; }
        // within reach, and in front of the plate (its normal leans toward the user)
        const p = ctrl.body.position;
        const front = (p.x - plate.position.x) * plate.normal.x + (p.z - plate.position.z) * plate.normal.z;
        if (palmDist(plate) > PALM_START || front <= 0) { resolve('refused'); return; }
        palm = { plate: { position: plate.position.clone(), normal: plate.normal.clone().normalize(), up: plate.up.clone().normalize() }, dur: Math.max(0.05, seconds), t: 0, pitch0: Math.min(pitch, 0.1), resolve };
        palmStow = true;
        syncStow();
        unstowIn = -1;
        look.active = false;
        palmHand.begin(palm.plate);
      });
    },
    cancelPalm() { endPalm('cancelled'); },
    cinematic(on: boolean, o?: { viewmodel?: 'hidden' | 'lowered'; topUp?: boolean }) {
      if (on) {
        const first = !cine;
        cine = { vm: o?.viewmodel ?? cine?.vm ?? 'hidden' };
        if (first) {
          if (palm) endPalm('cancelled');
          palmHand.hide();
          unstowIn = -1; palmStow = false;
          look.active = false; headUp = null;
          weapons.cancelReload();
          weapons.clearQueued();
          settle(ctrl, ctx.physics);
          noSprintT = 0;
          dbgMove.fwd = 0; dbgMove.strafe = 0; dbgMove.sprint = false; dbgMove.jump = false; dbgMove.crouch = false;
          dbgFire = false; dbgReload = false; dbgSlot = null;
        }
        if (o?.topUp) weapons.topUp();
        syncStow();
        vm.root.visible = cine.vm !== 'hidden';
      } else {
        if (!cine) return;
        if (o?.topUp) weapons.topUp();
        cine = null;
        standNow(ctrl);
        ctrl.body.velocity.set(0, 0, 0);
        clearJump(ctrl);
        weapons.clearQueued();
        // whatever is held across the hand-back (fire, the skip key) is ignored until released
        for (const c of ['Space', 'KeyE', 'KeyR', 'KeyF', 'KeyC']) if (ctx.input.down(c)) consumed.add(c);
        if (ctx.input.mouseDown(0)) consumed.add('Mouse0');
        syncStow();
        vm.root.visible = true;
      }
    },
    get inCinematic() { return !!cine; },
    view,
    setSafe(on: boolean) {
      if (on === safe) return;
      safe = on;
      if (on) weapons.clearQueued();
      syncStow();
    },
    get safe() { return safe; },
    consumeKey(code: string) {
      consumed.add(code);
      if (code === 'Space') clearJump(ctrl);
    },
    get palmProgress() { return palm ? clamp(palm.t / palm.dur, 0, 1) : -1; },
    shake(a: number) { camRig.shake(a); },
    setCarry(v: THREE.Vector3 | null) { ctrl.setCarry(v); },
    lookAt(point: THREE.Vector3, seconds: number) {
      const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
      look.y0 = yaw; look.p0 = pitch;
      look.y1 = yaw + wrapAngle(Math.atan2(-dx, -dz) - yaw);
      look.p1 = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_LIMIT, PITCH_LIMIT);
      look.t = 0; look.dur = Math.max(0.001, seconds); look.active = true;
    },
    // ── checkpoints (REVISION 3) ──
    snapshot(): PlayerSave {
      const r = (v: number) => Math.round(v * 1000) / 1000;
      const p = ctrl.body.position, ws = weapons.states;
      return {
        position: [r(p.x), r(p.y), r(p.z)],
        yaw: r(yaw),
        health: Math.round(health),
        weapons: Object.fromEntries(WEAPON_IDS.map((id) => [id, { owned: ws[id].owned, clip: ws[id].clip, reserve: ws[id].reserve }])) as PlayerSave['weapons'],
        current: weapons.current,
        keys: [...keys],
        flashlight: flash.on,
        pickups: [...pickups.collected],
        armor: Math.round(armor * 100) / 100,
      };
    },
    restore(save: PlayerSave) {
      player.teleport(new THREE.Vector3(save.position[0], save.position[1], save.position[2]), save.yaw, 0);
      ctrl.body.velocity.set(0, 0, 0);
      player.health = Math.max(1, save.health);
      armor = cleanArmor(save.armor); // a snap: no player:armor
      if (strap) endStrap(false);
      weapons.cancelReload();
      for (const id of WEAPON_IDS) {
        const w = save.weapons?.[id], s = weapons.states[id];
        if (!w) continue;
        s.owned = !!w.owned;
        s.clip = clamp(w.clip | 0, 0, s.clipSize);
        s.reserve = clamp(w.reserve | 0, 0, WEAPON_STATS[id].maxReserve);
        s.reloading = false;
      }
      weapons.addAmmo('shotgun', 0); // refreshes the shell saddle on the viewmodel
      weapons.syncRounds();
      const cur = save.current && weapons.states[save.current]?.owned ? save.current
        : (['carbine', 'shotgun', 'pistol'] as WeaponId[]).find((w) => weapons.states[w].owned) ?? null;
      if (cur) weapons.switchTo(cur, true);
      keys.clear();
      for (const k of save.keys ?? []) keys.add(k);
      flash.set(!!save.flashlight);
      ctrl.setCarry(null);
      pickups.restoreCollected(Array.isArray(save.pickups) ? save.pickups : []);
    },
    applyLoadout(save: Partial<PlayerSave>) {
      // Level change (REVISION 4): weapons / ammo / health / lamp only — no position, keys or pickup ids.
      if (save.weapons) {
        weapons.cancelReload();
        for (const id of WEAPON_IDS) {
          const w = save.weapons[id], s = weapons.states[id];
          if (!w) continue;
          s.owned = !!w.owned;
          s.clip = clamp(w.clip | 0, 0, s.clipSize);
          s.reserve = clamp(w.reserve | 0, 0, WEAPON_STATS[id].maxReserve);
          s.reloading = false;
        }
        weapons.addAmmo('shotgun', 0);
        weapons.syncRounds();
        const cur = save.current && weapons.states[save.current]?.owned ? save.current
          : (['carbine', 'shotgun', 'pistol'] as WeaponId[]).find((w) => weapons.states[w].owned) ?? null;
        if (cur) weapons.switchTo(cur, true);
      }
      // §8.2: armour comes with the carry (a snap: no player:armor)
      if ('armor' in save) armor = cleanArmor(save.armor);
      if (typeof save.health === 'number' && Number.isFinite(save.health)) player.health = Math.max(1, save.health);
      if (typeof save.flashlight === 'boolean') flash.set(save.flashlight);
    },
    revive(h = maxHealth) {
      alive = true; health = h; armor = 0; camRig.revive();
      ctx.render.post.setLowHealth(lowHealthAmount());
      const last = weapons.states.shotgun.owned && weapons.current === null ? null : null;
      void last;
      const id = (['carbine', 'shotgun', 'pistol'] as WeaponId[]).find((w) => weapons.states[w].owned) ?? null;
      if (id) weapons.switchTo(id, true);
    },

    update(dt: number) {
      lastMainUpdate = performance.now();
      time += dt;
      const inp = ctx.input;
      const active = controlsEnabled && alive && ctx.state === 'playing' && !cine;
      if (consumed.size) releaseConsumed();

      // ── look
      lastLookX = 0; lastLookY = 0;
      // ── palm scan: its clock and what ends it (walking away; death / loss of control / not playing)
      if (palm) {
        if (!active || palmDist(palm.plate) > PALM_CANCEL) endPalm('cancelled');
        else { palm.t += dt; if (palm.t >= palm.dur) endPalm('done'); }
      }
      if (unstowIn >= 0 && !palm) { unstowIn -= dt; if (unstowIn < 0) { palmStow = false; syncStow(); } }
      if (active) {
        const k = palm ? PALM_LOOK : 1;
        const dx = inp.mouseDX * SENSITIVITY * k, dy = inp.mouseDY * SENSITIVITY * k;
        if (dx || dy) { look.active = false; headUp = null; }
        yaw -= dx;
        if (dy > 0) weapons.compensate(dy); // pulling down against the climb
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
      if (headUp && dt > 0) {
        if (palm) headUp = null;
        else {
          headUp.t = Math.min(1, headUp.t + dt / 0.55);
          const k = headUp.t * headUp.t * (3 - 2 * headUp.t);
          const np = clamp(pitch + headUp.by * (k - headUp.k), -PITCH_LIMIT, PITCH_LIMIT);
          headUp.k = k;
          lastLookY += np - pitch; pitch = np;
          if (headUp.t >= 1) headUp = null;
        }
      }
      if (palm && dt > 0) {
        // the view eases onto the plate (a little above its centre: the hand sits low in the frame, the arm below it)
        const pl = palm.plate;
        const tx = pl.position.x + pl.up.x * 0.07 - eye.x, ty = pl.position.y + pl.up.y * 0.07 - eye.y, tz = pl.position.z + pl.up.z * 0.07 - eye.z;
        const k = 1 - Math.exp(-PALM_PULL * dt);
        const ny = yaw + wrapAngle(Math.atan2(-tx, -tz) - yaw) * k;
        const np = pitch + (clamp(Math.atan2(ty, Math.hypot(tx, tz)), -PITCH_LIMIT, PITCH_LIMIT) - pitch) * k;
        lastLookX += ny - yaw; lastLookY += np - pitch;
        yaw = ny; pitch = np;
      }
      // carbine recoil: the climb (and its recovery) moves the real aim
      if (weapons.aimDelta.pitch || weapons.aimDelta.yaw) {
        const np = clamp(pitch + weapons.aimDelta.pitch, -PITCH_LIMIT, PITCH_LIMIT);
        lastLookY += np - pitch; lastLookX += weapons.aimDelta.yaw;
        pitch = np; yaw += weapons.aimDelta.yaw;
      }
      yaw = wrapAngle(yaw);

      // ── vest strap clock and what breaks it off
      if (strap) {
        const sprinting = (isDown('ShiftLeft') || isDown('ShiftRight') || dbgMove.sprint) && (isDown('KeyW') || dbgMove.fwd > 0);
        const jumping = isPressed('Space') || dbgMove.jump;
        if (!active || sprinting || jumping || noteOpen()) endStrap(false);
        else { strap.t += dt; if (strap.t >= STRAP) endStrap(true); }
      }

      // ── movement
      noSprintT = Math.max(0, noSprintT - dt);
      if (active) {
        const f = (isDown('KeyW') ? 1 : 0) - (isDown('KeyS') ? 1 : 0) + dbgMove.fwd;
        const s = (isDown('KeyD') ? 1 : 0) - (isDown('KeyA') ? 1 : 0) + dbgMove.strafe;
        moveIn.fwd = clamp(f, -1, 1); moveIn.strafe = clamp(s, -1, 1);
        moveIn.sprint = isDown('ShiftLeft') || isDown('ShiftRight') || dbgMove.sprint;
        moveIn.jump = isPressed('Space') || dbgMove.jump;
        moveIn.crouchToggle = isPressed('KeyC');
        moveIn.crouchHold = dbgMove.crouch; // crouch is C only: Ctrl+W would close the tab mid-fight
        moveIn.noSprint = noSprintT > 0 || weapons.reloading || weapons.firedRecently > 0 || !!strap;
        dbgMove.jump = false;
      }
      ctrl.update(dt, active ? moveIn : null, yaw, ev);
      const feet = ctrl.body.position;
      eye.set(feet.x, feet.y + ctrl.eyeHeight, feet.z);

      // ── camera
      const bobAmp = ctrl.grounded ? clamp(ctrl.speed / MOVE.walk, 0, 1.4) : 0;
      const carrySpeed = Math.hypot(ctrl.carryVel.x, ctrl.carryVel.z);
      const cam = ctx.camera;
      // §8.2: in a scene the camera is the cutscene's; the body's own view still runs (published as `view`)
      const camFov = cam.fov;
      if (cine) { _camP.copy(cam.position); _camQ.copy(cam.quaternion); }
      camRig.update(dt, {
        eye, yaw, pitch, bobPhase: ctrl.bobPhase, bobAmp, sprint: ctrl.sprintBlend, crouch: ctrl.crouchBlend,
        eyeHeight: ctrl.eyeHeight, strafe: ctrl.strafeSpeed, time,
        shudder: ctrl.grounded && alive ? clamp(carrySpeed / 1.2, 0, 1) : 0, carrySpeed,
      });
      view.position.copy(cam.position); view.quaternion.copy(cam.quaternion); view.fov = cam.fov;
      if (cine) {
        cam.position.copy(_camP); cam.quaternion.copy(_camQ);
        if (cam.fov !== camFov) { cam.fov = camFov; cam.updateProjectionMatrix(); }
      }
      cam.updateMatrixWorld();
      computeBasis();
      palmHand.update(dt, ctx.camera, yaw);

      // ── wall proximity (viewmodel pull-back), throttled
      wallCheck -= dt;
      if (wallCheck <= 0) {
        wallCheck = 0.05;
        const hit = ctx.physics.raycast(eye, forward, 0.95);
        wallT = hit ? clamp((0.95 - hit.distance) / 0.6, 0, 1) : 0;
      }

      // ── weapons
      if (active) {
        wIn.firePressed = mousePress(0) || dbgFire;
        wIn.fireHeld = mouseHeld(0) || dbgHold;
        wIn.reload = isPressed('KeyR') || dbgReload;
        wIn.slot = isPressed('Digit1') ? 'pistol' : isPressed('Digit2') ? 'shotgun' : isPressed('Digit3') ? 'carbine' : dbgSlot;
        wIn.wheel = inp.wheel;
        if (wIn.firePressed && ctrl.sprinting) noSprintT = 0.4;
        dbgFire = false; dbgReload = false; dbgSlot = null;
      } else if (cine) {
        // §8.2: nothing asked for during a scene is kept for after it
        dbgFire = false; dbgReload = false; dbgSlot = null; dbgMove.jump = false; dbgHold = false;
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
      vm.carbine.lf.setLevel(health / maxHealth);
      mats.wristLed.emissive.setHex(health > 30 ? 0x30e0ff : 0xff3020);

      // ── flashlight
      if (active && isPressed('KeyF')) {
        flash.set(!flash.on);
        ctx.events.emit('player:flashlight', { on: flash.on });
      }
      const sway = ctrl.grounded ? Math.min(1, ctrl.speed / MOVE.walk) : 0;
      flash.update(dt, ctx.camera.position, ctx.camera.quaternion, forward,
        Math.sin(ctrl.bobPhase) * 0.012 * sway, -Math.abs(Math.cos(ctrl.bobPhase)) * 0.008 * sway);
      setVmLight(flash.level);

      // ── interaction
      focus = alive && !palm && !cine && !strap ? pickVisible() : null;
      if (active && focus && isPressed('KeyE')) ctx.interactables.use(focus);

      // ── pickups + HUD state
      pickups.update(dt, time, feet, alive);
      hitMarker = Math.max(0, hitMarker - dt * 3.5);
      void damp; void UP;
    },

    debug: {},
  };

  player.debug = {
    fire: () => { dbgFire = true; return weapons.current; },
    /** Hold / release the trigger (full auto). */
    hold: (on = true) => { dbgHold = on; return weapons.current; },
    /** Every shot exactly at a world point (no spread); null releases. */
    aimLock: (x: number | null, y = 0, z = 0) => { weapons.aimLock = x === null ? null : new THREE.Vector3(x, y, z); return !!weapons.aimLock; },
    /** The vest strap: its clock, or -1. */
    strap: () => (strap ? +strap.t.toFixed(3) : -1),
    /** Lights of the carbine muzzle pool (check-weapons). */
    muzzleLights: () => ctx.render.lights.group('player_muzzle').filter((h) => h.enabled).length,
    setArmor: (v: number) => { armor = cleanArmor(v); return armor; },
    reload: () => { dbgReload = true; return weapons.current; },
    switchTo: (id: WeaponId) => { dbgSlot = id; return id; },
    move: (fwd = 0, strafe = 0, sprint = false) => { dbgMove.fwd = fwd; dbgMove.strafe = strafe; dbgMove.sprint = sprint; },
    jump: () => { dbgMove.jump = true; },
    crouch: (on = true) => { dbgMove.crouch = on; },
    flashlight: (on = true) => { flash.set(on); ctx.events.emit('player:flashlight', { on }); return on; },
    spawnPickup: (kind: PickupKind, x: number, y: number, z: number, amount = 10) => pickups.add(kind, new THREE.Vector3(x, y, z), amount),
    state: () => ({
      pos: ctrl.body.position.toArray().map((v) => +v.toFixed(3)), vel: ctrl.body.velocity.toArray().map((v) => +v.toFixed(2)),
      carry: ctrl.carryVel.toArray().map((v) => +v.toFixed(2)),
      grounded: ctrl.grounded, crouched: ctrl.crouched, eyeHeight: +ctrl.eyeHeight.toFixed(3), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
      health, alive, weapon: weapons.current, weapons: JSON.parse(JSON.stringify(weapons.states)), flashlight: flash.on,
      focus: focus?.id ?? null, lower: +weapons.lower.toFixed(2), clip: vm.active?.player.name ?? '',
      cinematic: cine ? cine.vm : null, safe, stowed: weapons.isStowed, vmVisible: vm.root.visible, consumed: [...consumed],
      armor, strap: strap ? strap.t : -1, charger: vm.carbine.chargerLocked,
    }),
    setPose: (id: WeaponId, x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
      vm.rig(id).setBase(x, y, z, rx, ry, rz),
    stats: () => WEAPON_STATS,
    /** Slow tracers down for inspection (default 190 m/s). */
    tracerSpeed: (v = 190) => { weapons.tracers.speed = v; return v; },
    tracers: () => ({ visible: weapons.tracers.mesh.visible, count: weapons.tracers.mesh.geometry.drawRange.count / 6, layer: weapons.tracers.mesh.layers.mask }),
    grips: () => ({ pistol: vm.pistol.report, shotgun: vm.shotgun.report, carbine: vm.carbine.report }),
    /** REVISION 6.1: the palm scan — its clock, the hand's state, and the solved clearance (mm) of the flat pose over the plate. */
    palm: () => ({
      active: !!palm, t: palm ? +palm.t.toFixed(3) : 0, progress: palm ? +(palm.t / palm.dur).toFixed(3) : -1,
      hand: palmHand.mode, s: +palmHand.s.toFixed(3), down: palmHand.down, visible: palmHand.root.visible,
      wrist: palmHand.hand.root.position.toArray().map((v) => +v.toFixed(3)), clearance: palmHand.report, contact: palmHand.contact(), lower: +weapons.lower.toFixed(2),
    }),
  };

  if (ctx.debug.giveAll) {
    weapons.give('carbine', 90); // §7: ?give=all adds the carbine + 90
    weapons.give('shotgun', 36);
    weapons.give('pistol', 96);
    weapons.lower = 0;
  }
  ctx.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  return player;
}
