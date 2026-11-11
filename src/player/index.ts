// STUB — replaced by the player task. Walk + mouse look only.
import * as THREE from 'three';
import type { GameContext, Player, WeaponState } from '../core/types';

export async function createPlayer(ctx: GameContext): Promise<Player> {
  const spawn = ctx.debug.spawn ?? { position: ctx.level.spawn.position, yaw: ctx.level.spawn.yaw, pitch: 0 };
  const body = { position: spawn.position.clone(), velocity: new THREE.Vector3(), radius: 0.35, height: 1.8, onGround: false };
  const eye = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, -1);
  const weapon = (id: 'pistol' | 'shotgun'): WeaponState => ({ id, owned: false, clip: 0, clipSize: 12, reserve: 0, reloading: false });
  const keys = new Set<string>();
  const p: Player = {
    position: body.position, eye, forward, velocity: body.velocity,
    yaw: spawn.yaw, pitch: spawn.pitch, health: 100, maxHealth: 100, alive: true, controlsEnabled: true,
    flashlightOn: false, weapons: { pistol: weapon('pistol'), shotgun: weapon('shotgun') }, currentWeapon: null,
    focus: null, hitMarker: 0, keys,
    damage() {}, heal() {}, give() {}, hasKey: (k) => keys.has(k), addKey: (k) => { keys.add(k); },
    teleport(pos, yaw, pitch) { body.position.copy(pos); body.velocity.set(0, 0, 0); if (yaw !== undefined) p.yaw = yaw; if (pitch !== undefined) p.pitch = pitch; },
    shake() {}, lookAt() {},
    update(dt) {
      const i = ctx.input;
      p.yaw -= i.mouseDX * 0.0022; p.pitch = THREE.MathUtils.clamp(p.pitch - i.mouseDY * 0.0022, -1.5, 1.5);
      const f = (i.down('KeyW') ? 1 : 0) - (i.down('KeyS') ? 1 : 0), s = (i.down('KeyD') ? 1 : 0) - (i.down('KeyA') ? 1 : 0);
      const sp = i.down('ShiftLeft') ? 6 : 3.5;
      const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      body.velocity.x = (-sin * f + cos * s) * sp; body.velocity.z = (-cos * f - sin * s) * sp;
      if (i.pressed('Space') && body.onGround) body.velocity.y = 6;
      if (dt > 0) ctx.physics.moveBody(body, dt);
      eye.set(body.position.x, body.position.y + 1.65, body.position.z);
      ctx.camera.position.copy(eye);
      ctx.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      ctx.camera.getWorldDirection(forward);
      (p as any).focus = ctx.interactables.pick(eye, forward);
      if (p.focus && i.pressed('KeyE')) ctx.interactables.use(p.focus);
    },
  };
  return p;
}
