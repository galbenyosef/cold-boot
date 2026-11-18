/**
 * Level 6 — the moon pool (stage 3d §4.8, §5.5, §5.6.9, §7.1): the reveal, the loader's stages, the boss waves W1–W3 and
 * their twins (latest-only restore), the milestones with `checkpointNow`, the frame (pin → pump → lever), the shear, the
 * lockers and the ammo top-up, the quiet. **ST-b's file.** This is ST-a's STUB: the interface the route (script.ts) and
 * the hooks (index.ts) call, with the smallest behaviour that keeps the level whole — the loader is spawned when Key B
 * turns (D31) and on every restore with `shaftOpen && !loaderDead`, never enters `triggered`, and nothing else happens in
 * the chamber yet (a `--contract` run reads the H7 / H13 / H15 / H19 fields from here).
 *
 * What ST-b fills (every method below is called by script.ts / index.ts and must keep its signature):
 *   bossStart()            threads: the reveal (`t6_reveal`), the hostile start, W1–W3, milestones, the shear, the quiet
 *   bossStep(step)         every 0.2 s step (wave cap, flood-lit timer, the console nag, …)
 *   bossInteract(id)       frame6_pin / _pump / _lever, console6, locker6_e / _w / _n, note6_transfer → true when handled
 *   bossFire(name)         H3 names reveal, hostile, pin, pump, fire, ram_e, ram_w, pod, quiet, console → name | null
 *   bossReplay()           afterReplay, after the route's flags: loader spawn / restore / removeSilently, waves, lockers
 *   bossSnap()             afterSnap: screens, lights_out6 / loader_dead6 snaps, the cut tether
 *   bossCheckpoint(id)     the `cp6_m*` / `cp6_quiet` rules (saved with `checkpointNow`)
 *   bossFacts(), bossBusy(), bossObjective(), bossDebug(), bossWorld(), lockers()
 */
import * as THREE from 'three';
import type { BossState } from '../../core/types';
import type { CheckpointRule } from '../stage/base';
import { Base6, type BossFacts6 } from './base';
import { OBJ6 } from './text';

export type BossCheckpointId6 = 'cp6_m1' | 'cp6_m2' | 'cp6_m3' | 'cp6_m4' | 'cp6_m5' | 'cp6_quiet';

export abstract class Boss6 extends Base6 {
  /** Milestones reached, in order (H7 `boss.milestones`). */
  protected milestones: string[] = [];
  /** Script time of the hostile start (H7 `boss.hostileAt`). */
  protected hostileAt: number | null = null;

  /** The loader (D31): spawned with `spawnGroup` — never `engage`, never in `triggered` (§7.1). */
  protected spawnLoader(): void {
    if (this.f.loaderDead || this.members('g6_loader').length > 0) return;
    this.spawnedGroups.add('g6_loader');
    this.w.spawnGroup('g6_loader');
  }
  protected loaderAlive(): boolean { return this.members('g6_loader').length > 0; }

  // ── the interface (ST-b replaces the bodies) ──

  protected bossStart(): void { /* ST-b: the reveal, the hostile start, waves, milestones, the shear, the quiet */ }
  protected bossStep(_step: number): void { /* ST-b */ }
  protected bossInteract(_id: string): boolean { return false; }
  protected bossFire(_name: string): string | null { return null; }
  /** afterReplay, after the route's flags (§7 order: `shaftOpen` → spawn the loader; then `loaderDead` / `hostile` …). */
  protected bossReplay(): void {
    const f = this.f;
    f.storesOpen = false;
    if (f.shaftOpen && !f.loaderDead) this.spawnLoader();
  }
  protected bossSnap(): void { /* ST-b */ }
  /** No checkpoint now (a boss grip, the cutscene) — on top of the route's blocks. */
  protected bossBlocked(): boolean { return false; }
  /** A scare may not fire now (§5.7 boss rule: none from the hostile start until `l6_quiet`). */
  protected bossNoScare(): boolean { return this.f.hostile && !this.f.quiet; }
  /** Q in phase K: the boss hint id (null = the route picks it). */
  protected bossHint(): string | null { return null; }
  protected bossCheckpoint(_id: BossCheckpointId6): CheckpointRule { return { when: () => false, valid: () => false }; }

  protected bossFacts(): BossFacts6 {
    const f = this.f;
    let soldier = false;
    try { soldier = this.ctx.enemies.all.some((e) => e.alive && e.type === 'soldier'); } catch { /* ignore */ }
    return {
      stage: 0, loaderAlive: this.loaderAlive(), loaderInView: this.memberInView('g6_loader', 50), onDock: this.region3('dock'),
      inCage: this.inTrig('t6_cage'), soldierAlive: soldier, floodLitFor: 0, floodAlive: false, slamRecoveryInView: false,
      ramsGone: (f.ramE ? 1 : 0) + (f.ramW ? 1 : 0), endingPending: f.quiet && f.trunkCut && f.loaderDead && !f.ending, inEnding: false,
    };
  }
  /** §7.1: the loader alive and past `working` is not calm (stub: once the hostile start happened). */
  protected bossBusy(): boolean { return this.f.hostile && !this.f.loaderDead && this.loaderAlive(); }
  /** The objective in phase K past the reveal (null = the route's `The moon pool — down the stairs`). */
  protected bossObjective(): string | null {
    const f = this.f;
    if (f.quiet) return f.ending ? OBJ6.none : OBJ6.console;
    if (f.trunkCut && !f.loaderDead) return OBJ6.loader;
    if (f.hostile) return OBJ6.tether;
    return null;
  }
  /** H7 `boss`, `frame`, `ending`. */
  protected bossDebug(): {
    boss: { stage: number; mode: string | null; parts: Record<string, number>; floods: boolean[]; slots: (string | null)[]; waves: { w1: unknown; w2: unknown; w3: unknown }; milestones: string[]; hostileAt: number | null };
    frame: { pin: boolean; pressure: number; fired: boolean };
    ending: { pending: boolean; started: boolean; times: Record<string, number> | null; result: string | null };
  } {
    const f = this.f;
    const ctl = this.bossCtl();
    const row = this.loaderRow();
    const parts: Record<string, number> = {};
    for (const p of ['flood_1', 'flood_2', 'flood_3', 'flood_4', 'ram_e', 'ram_w', 'pod']) { try { parts[p] = ctl ? ctl.partHp(p) : 0; } catch { parts[p] = 0; } }
    const w = this.prog.waves;
    return {
      boss: {
        stage: ctl?.stage ?? 0, mode: typeof row?.mode === 'string' ? row.mode : null, parts,
        floods: ['flood_1', 'flood_2', 'flood_3', 'flood_4'].map((p) => (parts[p] ?? 0) > 0),
        slots: this.slots(), waves: { w1: w.w1, w2: w.w2, w3: w.w3 }, milestones: [...this.milestones], hostileAt: this.hostileAt,
      },
      frame: { pin: f.pin, pressure: Number(f.pressure) || 0, fired: f.trunkCut },
      ending: { pending: this.bossFacts().endingPending, started: f.ending, times: null, result: null },
    };
  }
  /** H13 boss part: `boss`, `slots`, `frame`, `waves`. */
  protected bossWorld(): { boss: BossState | null; slots: (string | null)[]; frame: { pin: boolean; pressure: number; fired: boolean }; waves: unknown } {
    const ctl = this.bossCtl();
    let snap: BossState | null = null;
    try { snap = ctl ? ctl.snapshot() : null; } catch { snap = null; }
    const f = this.f;
    return { boss: snap, slots: this.slots(), frame: { pin: f.pin, pressure: Number(f.pressure) || 0, fired: f.trunkCut }, waves: { ...this.prog.waves } };
  }
  /** H19: the dock ammo lockers (armed = not taken since the last milestone). */
  lockers(): { e: { armed: boolean }; w: { armed: boolean }; n: { armed: boolean } } {
    const l = this.prog.lockers;
    return { e: { armed: !l.e }, w: { armed: !l.w }, n: { armed: !l.n } };
  }

  protected bossCtl() {
    try { return this.ctx.enemies.boss('g6_loader'); } catch { return null; }
  }
  protected loaderRow(): Record<string, unknown> | null {
    try {
      const d = (this.ctx.enemies as unknown as { debug?: { loader?: (g?: string) => unknown } }).debug;
      return (d?.loader?.('g6_loader') as Record<string, unknown>) ?? null;
    } catch { return null; }
  }
  protected slots(): (string | null)[] {
    try { return (this.ctx.level.dock?.slots ?? []).map((s) => s.container); } catch { return []; }
  }
  /** A point helper for ST-b (the loader's PA: the trolley's position, from the enemy). */
  protected loaderPoint(): THREE.Vector3 | null {
    const m = this.members('g6_loader')[0];
    return m ? m.position.clone() : null;
  }
}
