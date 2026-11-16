/** Trigger volumes → `trigger:enter` / `trigger:exit` from the player's feet position. */
import type { GameContext } from '../core/types';

/**
 * A trigger box of the player's FEET: plan box x0…x1, z0…z1 and the feet height y0 < y < y1
 * (stage 3a §8.9: Deck-2 triggers give e.g. y0 4, y1 7). Default y range −1 … 4 (levels 1–2, Deck 1).
 */
export interface TriggerSpec { id: string; x0: number; x1: number; z0: number; z1: number; y0?: number; y1?: number }

/** Feet height range of a trigger (defaults = Deck 1). */
export const TRIGGER_Y0 = -1, TRIGGER_Y1 = 4;

export const TRIGGERS: TriggerSpec[] = [
  { id: 't_med_exit', x0: -1.5, x1: 1.5, z0: -2.2, z1: -0.25 },
  { id: 't_corr_mid', x0: -1.5, x1: 1.5, z0: -8.0, z1: -6.0 },
  { id: 't_quarters', x0: -9.5, x1: -2.2, z0: -11, z1: -3 },
  { id: 't_junction', x0: -2.8, x1: 2.8, z0: -19.8, z1: -14.0 },
  { id: 't_sec', x0: -11, x1: -3.25, z0: -21, z1: -13 },
  { id: 't_storage', x0: 3.25, x1: 10, z0: -21, z1: -13 },
  { id: 't_airlock', x0: -2, x1: 2, z0: -25.75, z1: -20.25 },
  { id: 't_fab_enter', x0: -12, x1: 12, z0: -29.2, z1: -26.25 },
  { id: 't_fab_mid', x0: -12, x1: 12, z0: -49.75, z1: -36 },
  { id: 't_pump', x0: -22, x1: -12.7, z0: -44, z1: -32 },
  { id: 't_pump_deep', x0: -22, x1: -17, z0: -44, z1: -32 },
  { id: 't_gen', x0: 12.25, x1: 22, z0: -44, z1: -32 },
  { id: 't_lobby', x0: -4, x1: 4, z0: -57.75, z1: -50.25 },
  { id: 't_elevator', x0: -2.5, x1: 2.5, z0: -63, z1: -58.35 },
];

/** Is a feet position inside the trigger (`m` = hysteresis margin in plan; the y range is exact)? */
export function inTrigger(t: TriggerSpec, x: number, y: number, z: number, m = 0): boolean {
  return x >= t.x0 - m && x <= t.x1 + m && z >= t.z0 - m && z <= t.z1 + m && y > (t.y0 ?? TRIGGER_Y0) && y < (t.y1 ?? TRIGGER_Y1);
}

export class TriggerSystem {
  private inside: boolean[];
  constructor(private ctx: GameContext, private specs: TriggerSpec[]) {
    this.inside = specs.map(() => false);
    // checks (scripts/check-reach.mjs: "every trigger contains a reachable node") read the live specs here
    // until the contract exposes them on Level (stage 3a K3 → coordinator)
    (ctx as unknown as { __triggers?: readonly TriggerSpec[] }).__triggers = specs;
  }
  update() {
    const player = this.ctx.player;
    if (!player) return;
    const p = player.position;
    const specs = this.specs, inside = this.inside;
    for (let i = 0; i < specs.length; i++) {
      const t = specs[i];
      // small hysteresis so standing on an edge does not flap (plan only, as before: the y range is exact)
      const m = inside[i] ? 0.12 : 0;
      const now = inTrigger(t, p.x, p.y, p.z, m);
      if (now !== inside[i]) {
        inside[i] = now;
        this.ctx.events.emit(now ? 'trigger:enter' : 'trigger:exit', { id: t.id });
      }
    }
  }
}
