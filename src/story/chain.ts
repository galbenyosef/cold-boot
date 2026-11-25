/**
 * The level chain (stage 3a §8.1): facts at boot, the start loadout of a level, and the hand-over at a level's end.
 * Shared by every level's story. Owned by the coordinator.
 */
import type { CarryV2, DebugFlags, Facts, GameContext, LevelId, PickupKind, PlayerSave } from '../core/types';
import { WEAPON_IDS } from '../core/types';
import { levelInfo, levelOf, nextOf, setStoredLevel } from '../core/progress';
import { clearLevelSave, loadCarryFor, makeCarry, requestContinue, writeCarry } from './save';
import { reloadPage } from '../core/nav';

/** URL parameters that force a level / its facts: dropped on a hand-over so the stored level wins. */
const FORCING_PARAMS = ['level', 'choice', 'units', 'continue'];

/**
 * The facts a level is entered with (main.ts, before any system is built): the level's direct-start defaults, then
 * the carry that leads into it, then `?choice=` / `?units=`.
 */
export function startFacts(level: LevelId, debug: DebugFlags): Facts {
  const facts: Facts = { ...levelInfo(level).direct.facts };
  const carry = loadCarryFor(level, debug);
  if (carry) Object.assign(facts, carry.facts);
  if (debug.choice) facts.choice = debug.choice;
  if (debug.units !== null && debug.units !== undefined) facts.unitsLeft = debug.units;
  return facts;
}

/**
 * How a level end treats the chain. Headless test runs (`?autostart=1`) store nothing unless `&handoff=1` (then
 * everything is stored but the page is not reloaded); a real run stores and reloads into the next level.
 */
export function chainMode(ctx: GameContext): 'off' | 'store' | 'reload' {
  if (!ctx.debug.autostart) return 'reload';
  let on = false;
  try { on = new URLSearchParams(location.search).get('handoff') === '1'; } catch { /* ignore */ }
  return on ? 'store' : 'off';
}

/**
 * Store the end of this level: the carry (loadout + facts), then this level's checkpoint is cleared. When the level
 * has a next (`nextOf`: `LEVELS[id].next`, or the test override `?next=`), that level's old checkpoint is cleared and
 * it becomes the stored level. Returns the next level or null.
 */
export function finishLevel(ctx: GameContext, carry: CarryV2): LevelId | null {
  writeCarry(carry);
  clearLevelSave(ctx.levelId);
  const next = nextOf(ctx.levelId, ctx.debug);
  if (next === null) { setStoredLevel(ctx.levelId); return null; }
  clearLevelSave(next);
  setStoredLevel(next);
  return next;
}

/** Reload into the stored level behind the one-click gate (drops forcing URL parameters). */
export function goToLevel(): void {
  requestContinue();
  try {
    const u = new URL(location.href);
    let changed = false;
    for (const k of FORCING_PARAMS) if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
    if (changed) { reloadPage(u.toString()); return; }
  } catch { /* ignore */ }
  reloadPage();
}

/** This level's carry: the player as now, plus `ctx.facts` and `extra` facts. */
export function carryOut(ctx: GameContext, extra: Facts = {}): CarryV2 {
  return makeCarry(ctx.levelId, ctx.player.snapshot(), { ...ctx.facts, ...extra });
}

/**
 * §8.1 `handOff`: store the carry and move on. false (and nothing reloads) when `nextOf(level)` is null or the
 * chain is off / store-only in a test run; true when the page is navigating away.
 */
export function handOff(ctx: GameContext, carry: CarryV2): boolean {
  const mode = chainMode(ctx);
  if (mode === 'off') return false;
  const next = finishLevel(ctx, carry);
  if (next === null || mode === 'store') return false;
  goToLevel();
  return true;
}

/**
 * A new run of this level starts with what the previous level ended with (the carry; health raised to the level's
 * floor; armour as carried, clamped 0 … 100 by `readCarry`), or — arriving by a debug URL — the level's direct-start
 * loadout (§7; `armor` through `Player.addArmor`). Skipped when the player module already armed the player.
 */
export function applyStartLoadout(ctx: GameContext): 'carry' | 'direct' | 'none' {
  const p = ctx.player;
  const info = levelOf(ctx);
  try {
    if (WEAPON_IDS.some((id) => p.weapons[id]?.owned)) return 'none';
    const carry = loadCarryFor(ctx.levelId, ctx.debug);
    if (carry) {
      const save: PlayerSave = { ...p.snapshot(), health: Math.max(info.healthFloor, carry.health), weapons: carry.weapons, current: carry.current, flashlight: carry.flashlight, armor: carry.armor };
      const apply = (p as unknown as { applyLoadout?: (s: PlayerSave) => void }).applyLoadout;
      if (typeof apply === 'function') apply.call(p, save); else p.restore(save);
      return 'carry';
    }
    const d = info.direct.loadout;
    if (!d) return 'none';
    for (const id of WEAPON_IDS) {
      const w = d.weapons[id];
      if (!w) continue;
      p.give(id, w.clip);
      p.give(`ammo_${id}` as PickupKind, w.reserve);
    }
    if (d.health > p.health) p.heal(d.health - p.health);
    if (d.armor && d.armor > 0) p.addArmor(d.armor);
    if (d.flashlight && !p.flashlightOn) {
      const apply = (p as unknown as { applyLoadout?: (s: Partial<PlayerSave>) => void }).applyLoadout;
      if (typeof apply === 'function') apply.call(p, { flashlight: true });
    }
    return 'direct';
  } catch (e) { console.warn('[story] loadout failed', e); return 'none'; }
}
