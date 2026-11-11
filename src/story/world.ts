/**
 * Null-safe wrappers around the systems the story drives. Every lookup may be missing (other modules
 * land incrementally); the story must never throw because a door / screen / light group is absent.
 */
import * as THREE from 'three';
import type { EnemyActor, EnemySpawn, EnemyType, FlickerMode, GameContext, LightGroupPatch, PickupSpawn, ScreenKind } from '../core/types';

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

  // ── revision 2 (all optional at runtime: the level / enemies modules may not implement them yet) ──

  /** Fire a level vignette. Returns false when the level has no `vignette()` (caller may fall back). */
  vignette(id: string): boolean {
    const lv = this.ctx.level as unknown as { vignette?: (id: string) => void };
    if (typeof lv?.vignette !== 'function') return false;
    try { lv.vignette(id); return true; } catch (e) { console.warn(`[story] vignette ${id} failed`, e); return false; }
  }

  /** A scripted puppet, or null when `enemies.actor` is missing / throws. */
  actor(type: EnemyType, position: THREE.Vector3, yaw = 0, pose?: string): EnemyActor | null {
    const en = this.ctx.enemies as unknown as { actor?: (t: EnemyType, p: THREE.Vector3, y?: number, pose?: string) => EnemyActor };
    if (typeof en?.actor !== 'function') return null;
    try { return en.actor(type, position, yaw, pose) ?? null; } catch (e) { console.warn('[story] actor failed', e); return null; }
  }

  /** Remove an actor, swallowing errors. */
  removeActor(a: EnemyActor | null): void {
    if (!a) return;
    try { a.remove(); } catch { /* ignore */ }
  }

  /** Take a light group to black and bring it back exactly as it was (per-light scale is preserved). */
  blackout(group: string): () => void {
    const saved: { h: { intensityScale: number }; s: number }[] = [];
    try {
      for (const h of this.ctx.render.lights.group(group)) { saved.push({ h, s: h.intensityScale }); h.intensityScale = 0; }
    } catch { /* ignore */ }
    let done = false;
    return () => { if (done) return; done = true; for (const e of saved) { try { e.h.intensityScale = e.s; } catch { /* ignore */ } } };
  }

  spawns(group: string): EnemySpawn[] {
    try { return this.ctx.level.enemySpawns.filter((s) => s.group === group); } catch { return []; }
  }
  pickupSpawn(kind: string): PickupSpawn | null {
    try { return this.ctx.level.pickupSpawns.find((s) => s.kind === kind) ?? null; } catch { return null; }
  }
  hasRoom(id: string): boolean {
    try { return this.ctx.level.rooms.some((r) => r.id === id); } catch { return false; }
  }
  hasDoor(id: string): boolean {
    try { return this.ctx.level.doors.some((d) => d.id === id); } catch { return false; }
  }
  interactablePos(id: string): THREE.Vector3 | null {
    try { return this.ctx.interactables.get(id)?.position.clone() ?? null; } catch { return null; }
  }
  setPrompt(id: string, prompt: string): void {
    const i = this.ctx.interactables.get(id);
    if (i && i.prompt !== prompt) i.prompt = prompt;
  }
  hasKey(): boolean {
    try {
      const p = this.ctx.player;
      return p.keys.size > 0 || p.hasKey('keycard') || p.hasKey('p_lockout_key');
    } catch { return false; }
  }
  active(): number {
    try { return this.ctx.enemies.activeCount; } catch { return 0; }
  }

  glitch(amount: number, hold?: number): void { this.safe('glitch', () => this.ctx.render.post.glitch(amount, hold)); }
  fade(to: number, seconds: number): void { this.safe('fade', () => this.ctx.render.post.fade(to, seconds)); }
  shake(amount: number): void { this.safe('shake', () => this.ctx.player.shake(amount)); }
}
