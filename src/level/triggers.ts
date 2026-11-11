/** Trigger volumes → `trigger:enter` / `trigger:exit` from the player's feet position. */
import type { GameContext } from '../core/types';

export interface TriggerSpec { id: string; x0: number; x1: number; z0: number; z1: number }

export const TRIGGERS: TriggerSpec[] = [
  { id: 't_med_exit', x0: -1.5, x1: 1.5, z0: -2.2, z1: -0.25 },
  { id: 't_corr_mid', x0: -1.5, x1: 1.5, z0: -8.0, z1: -6.0 },
  { id: 't_junction', x0: -2.8, x1: 2.8, z0: -19.8, z1: -14.0 },
  { id: 't_sec', x0: -11, x1: -3.25, z0: -21, z1: -13 },
  { id: 't_storage', x0: 3.25, x1: 10, z0: -21, z1: -13 },
  { id: 't_airlock', x0: -2, x1: 2, z0: -25.75, z1: -20.25 },
  { id: 't_fab_enter', x0: -12, x1: 12, z0: -29.2, z1: -26.25 },
  { id: 't_fab_mid', x0: -12, x1: 12, z0: -49.75, z1: -36 },
  { id: 't_gen', x0: 12.25, x1: 22, z0: -44, z1: -32 },
  { id: 't_lobby', x0: -4, x1: 4, z0: -57.75, z1: -50.25 },
  { id: 't_elevator', x0: -2.5, x1: 2.5, z0: -63, z1: -58.35 },
];

export class TriggerSystem {
  private inside: boolean[];
  constructor(private ctx: GameContext, private specs: TriggerSpec[]) {
    this.inside = specs.map(() => false);
  }
  update() {
    const player = this.ctx.player;
    if (!player) return;
    const p = player.position;
    const specs = this.specs, inside = this.inside;
    for (let i = 0; i < specs.length; i++) {
      const t = specs[i];
      // small hysteresis so standing on an edge does not flap
      const m = inside[i] ? 0.12 : 0;
      const now = p.x >= t.x0 - m && p.x <= t.x1 + m && p.z >= t.z0 - m && p.z <= t.z1 + m && p.y > -1 && p.y < 4;
      if (now !== inside[i]) {
        inside[i] = now;
        this.ctx.events.emit(now ? 'trigger:enter' : 'trigger:exit', { id: t.id });
      }
    }
  }
}
