import * as THREE from 'three';
import type { DebugFlags, Quality } from './types';

export function parseDebug(): DebugFlags {
  const q = new URLSearchParams(location.search);
  const on = (k: string) => q.has(k) && q.get(k) !== '0';
  let spawn: DebugFlags['spawn'] = null;
  if (q.has('spawn')) {
    const n = q.get('spawn')!.split(',').map(Number);
    if (n.length >= 3 && n.every((v) => Number.isFinite(v))) {
      spawn = {
        position: new THREE.Vector3(n[0], n[1], n[2]),
        yaw: THREE.MathUtils.degToRad(n[3] ?? 0),
        pitch: THREE.MathUtils.degToRad(n[4] ?? 0),
      };
    }
  }
  const quality = q.get('quality');
  return {
    autostart: on('autostart'),
    spawn,
    noEnemies: on('noenemies'),
    noStory: on('nostory'),
    god: on('god'),
    giveAll: q.get('give') === 'all',
    quality: (['low', 'medium', 'high', 'ultra'] as const).includes(quality as Quality) ? (quality as Quality) : null,
    verbose: on('debug'),
    fps: 0,
  };
}
