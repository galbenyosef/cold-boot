// STUB — replaced by the fx task.
import type { FxSystem, GameContext } from '../core/types';

export async function createFx(_ctx: GameContext): Promise<FxSystem> {
  return {
    sparks() {}, smoke() {}, fluid() {}, decal() {}, flash() {}, arc() {}, explosion() {}, debris() {},
    emitter() { return { stop() {}, enabled: true }; },
    update() {},
  };
}
