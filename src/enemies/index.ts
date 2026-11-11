// STUB — replaced by the enemies task.
import type { EnemyManager, GameContext } from '../core/types';

export async function createEnemies(_ctx: GameContext): Promise<EnemyManager> {
  return {
    all: [], activeCount: 0,
    spawn() { throw new Error('enemies stub'); },
    spawnGroup() {}, wakeGroup() {}, hitscan: () => null, damage() {}, alertNoise() {}, aliveInGroup: () => 0, update() {},
  };
}
