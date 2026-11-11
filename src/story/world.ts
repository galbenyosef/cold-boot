/**
 * Null-safe wrappers around the systems the story drives. Every lookup may be missing (other modules
 * land incrementally); the story must never throw because a door / screen / light group is absent.
 */
import * as THREE from 'three';
import type { FlickerMode, GameContext, LightGroupPatch, ScreenKind } from '../core/types';

export const ALL_SCREENS = [
  'med_terminal', 'sec_console', 'sec_monitor_1', 'sec_monitor_2', 'sec_monitor_3', 'sec_monitor_4',
  'fab_bigscreen', 'gen_terminal', 'lobby_screen', 'elev_panel',
];

export class World {
  constructor(private ctx: GameContext) {}

  private safe(label: string, fn: () => void): void {
    try { fn(); } catch (e) { console.warn(`[story] ${label} failed`, e); }
  }

  lock(id: string): void { this.safe(`lock ${id}`, () => this.ctx.level.door(id)?.lock()); }
  unlock(id: string): void { this.safe(`unlock ${id}`, () => this.ctx.level.door(id)?.unlock()); }
  isLocked(id: string): boolean {
    try { return !!this.ctx.level.door(id)?.locked; } catch { return false; }
  }

  lights(group: string, patch: LightGroupPatch): void {
    this.safe(`lights ${group}`, () => this.ctx.render.lights.setGroup(group, patch));
  }
  /** Restore each light's authored colour (after a scripted tint). */
  restoreColor(group: string): void {
    this.safe(`restoreColor ${group}`, () => {
      for (const h of this.ctx.render.lights.group(group)) h.setColor(h.desc.color);
    });
  }
  flicker(group: string, mode: FlickerMode): void { this.lights(group, { flicker: mode }); }

  machine(name: string, state: 'off' | 'idle' | 'active' | 'frenzy'): void {
    this.safe(`machine ${name}`, () => this.ctx.level.setMachine(name, state));
  }

  screen(name: string, kind: ScreenKind, text?: string): void {
    this.safe(`screen ${name}`, () => {
      const m = this.ctx.level.screen(name);
      if (m) this.ctx.materials.setScreen(m, kind, text !== undefined ? { text } : undefined);
    });
  }

  play(id: string, position?: THREE.Vector3, volume?: number): void {
    this.safe(`play ${id}`, () => this.ctx.audio.play(id, { position, volume }));
  }

  spawnGroup(g: string): void { this.safe(`spawnGroup ${g}`, () => this.ctx.enemies.spawnGroup(g)); }
  wakeGroup(g: string, stagger?: number): void { this.safe(`wakeGroup ${g}`, () => this.ctx.enemies.wakeGroup(g, stagger)); }

  alive(g: string): number {
    let n = 0;
    try { n = this.ctx.enemies.aliveInGroup(g); } catch { /* ignore */ }
    try { for (const e of this.ctx.enemies.all) if (e.group === g && e.alive) n = Math.max(n, 1); } catch { /* ignore */ }
    return n;
  }

  room(): string | null {
    try { return this.ctx.level.roomAt(this.ctx.player.position)?.id ?? null; } catch { return null; }
  }

  objectPos(name: string, fallback: THREE.Vector3): THREE.Vector3 {
    try {
      const o = this.ctx.level.object(name);
      if (o) return o.getWorldPosition(new THREE.Vector3());
    } catch { /* ignore */ }
    return fallback.clone();
  }

  setInteractable(id: string, enabled: boolean): boolean {
    const i = this.ctx.interactables.get(id);
    if (i) i.enabled = enabled;
    return !!i;
  }

  glitch(amount: number, hold?: number): void { this.safe('glitch', () => this.ctx.render.post.glitch(amount, hold)); }
  fade(to: number, seconds: number): void { this.safe('fade', () => this.ctx.render.post.fade(to, seconds)); }
  shake(amount: number): void { this.safe('shake', () => this.ctx.player.shake(amount)); }
}
