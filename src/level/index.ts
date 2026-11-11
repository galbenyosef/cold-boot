// STUB — replaced by the level task. One box room so other systems have something to stand in.
import * as THREE from 'three';
import type { Door, GameContext, Level, Room } from '../core/types';

export async function createLevel(ctx: GameContext): Promise<Level> {
  const root = new THREE.Group();
  ctx.scene.add(root);
  const colliders: THREE.Mesh[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    root.add(m); colliders.push(m);
    return m;
  };
  const wall = ctx.materials.get('wall_panel'), floor = ctx.materials.get('floor_plate');
  box(10, 0.2, 60, 0, -0.1, -20, floor);
  box(10, 0.2, 60, 0, 3.3, -20, ctx.materials.get('ceiling_panel'));
  box(0.2, 3.4, 60, -5, 1.6, -20, wall);
  box(0.2, 3.4, 60, 5, 1.6, -20, wall);
  box(10, 3.4, 0.2, 0, 1.6, 10, wall);
  box(10, 3.4, 0.2, 0, 1.6, -50, wall);
  box(1, 1, 1, 2, 0.5, 2, ctx.materials.get('painted_yellow'));
  for (let z = 6; z > -50; z -= 8) {
    ctx.render.lights.add({ type: 'point', position: new THREE.Vector3(0, 2.9, z), color: 0xdfe8ff, intensity: 30, distance: 10, group: 'stub' });
  }
  const rooms: Room[] = [{ id: 'stub', name: 'STUB', bounds: new THREE.Box3(new THREE.Vector3(-5, 0, -50), new THREE.Vector3(5, 3.2, 10)) }];
  const fakeDoor = (id: string): Door => ({
    id, position: new THREE.Vector3(), locked: false, isOpen: true, auto: true, open() {}, close() {}, lock() {}, unlock() {},
  });
  return {
    root, colliders, spawn: { position: new THREE.Vector3(0, 0, 7), yaw: 0 }, rooms,
    roomAt: () => rooms[0], door: fakeDoor, doors: [], enemySpawns: [], pickupSpawns: [], nav: [],
    probes: [new THREE.Vector3(0, 1.6, 0)],
    object: () => undefined, setMachine() {}, screen: () => undefined, update() {},
  };
}
