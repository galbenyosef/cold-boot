/**
 * Gamepad (standard mapping: Xbox / PlayStation / MFi controllers, also on iPhone / iPad Safari).
 *
 * Polled once per frame and fed into the same virtual input the touch controls use (Input.inject / injectLook /
 * injectStick), so the player and the UI need no gamepad code of their own.
 *
 *   left stick   move (pushed fully forward or L3: run)     right stick  look
 *   RT  fire     LT  aim     A  jump     B  crouch     X  reload     Y  next weapon
 *   RB  use      LB  flashlight     D-pad up  radio     Start  pause     L3  run
 *
 * Menus (main menu, pause, death, ending): D-pad / left stick up-down moves between the visible buttons, A presses.
 */
import type { GameContext, WeaponId } from './types';

const DEAD = 0.16;
/** Look speed at full right-stick deflection, in mouse pixels per second (× the player's 0.0022 rad/px ≈ 200°/s). */
const LOOK_PX = 1600;
const LOOK_Y = 0.7;
const SPRINT_TILT = 0.93;
const WEAPON_ORDER: readonly WeaponId[] = ['pistol', 'shotgun', 'carbine'];

/** Button index (standard mapping) → input code; 'swap' cycles weapons. */
const BUTTONS: ReadonlyArray<[number, string]> = [
  [7, 'Mouse0'], [6, 'Mouse2'], [0, 'Space'], [1, 'KeyC'], [2, 'KeyR'], [3, 'swap'],
  [5, 'KeyE'], [4, 'KeyF'], [12, 'KeyQ'], [9, 'Escape'], [10, 'ShiftLeft'],
];

export function createGamepad(ctx: GameContext): { update(dt: number): void } {
  const was = new Map<number, boolean>();
  let stickOn = false;
  let sprintHeld = false;
  const release: string[] = [];

  const axis = (v: number) => {
    const a = Math.abs(v);
    if (a < DEAD) return 0;
    const t = (a - DEAD) / (1 - DEAD);
    return Math.sign(v) * t;
  };

  const swap = () => {
    const pl = ctx.player;
    if (!pl) return;
    const owned = WEAPON_ORDER.filter((w) => pl.weapons?.[w]?.owned);
    if (!owned.length) return;
    const i = pl.currentWeapon ? owned.indexOf(pl.currentWeapon) : -1;
    const code = `Digit${WEAPON_ORDER.indexOf(owned[(i + 1) % owned.length]) + 1}`;
    ctx.input.inject(code, true);
    release.push(code);
  };

  const releaseAll = () => {
    for (const [i, code] of BUTTONS) if (was.get(i) && code !== 'swap') ctx.input.inject(code, false);
    was.clear();
    if (sprintHeld) { ctx.input.inject('ShiftLeft', false); sprintHeld = false; }
    if (stickOn) { ctx.input.injectStick(0, 0); stickOn = false; }
  };

  // ── menus: focus walks the visible .btn buttons of the UI
  let focus: HTMLElement | null = null;
  let navWas = 0, navT = 0, aWas = false, startWas = false, inMenu = true;
  const buttons = () => Array.from(document.querySelectorAll<HTMLElement>('#ui .btn'))
    .filter((b) => b.offsetParent !== null && !(b as HTMLButtonElement).disabled && getComputedStyle(b).visibility !== 'hidden');
  const setFocus = (b: HTMLElement | null) => {
    focus?.classList.remove('padfocus');
    focus = b;
    focus?.classList.add('padfocus');
  };
  const menu = (pad: Gamepad, dt: number) => {
    const list = buttons();
    if (focus && !list.includes(focus)) setFocus(null);
    const up = pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -0.6;
    const down = pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > 0.6;
    const nav = up ? -1 : down ? 1 : 0;
    navT -= dt;
    if (nav && list.length && (nav !== navWas || navT <= 0)) {
      const i = focus ? list.indexOf(focus) : -1;
      setFocus(list[i < 0 ? (nav > 0 ? 0 : list.length - 1) : (i + nav + list.length) % list.length]);
      navT = nav !== navWas ? 0.4 : 0.15; // hold to repeat
    }
    navWas = nav;
    const a = !!pad.buttons[0]?.pressed;
    if (a && !aWas) {
      const b = focus ?? list[0];
      if (b) b.click();
      else document.getElementById('ui')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // "click to begin"
    }
    aWas = a;
  };

  return {
    update(dt: number) {
      const inp = ctx.input;
      while (release.length) inp.inject(release.pop()!, false);
      if (!navigator.getGamepads) return;
      let pad: Gamepad | null = null;
      for (const g of navigator.getGamepads()) if (g && g.connected && g.mapping === 'standard') { pad = g; break; }
      if (!pad) { if (was.size || stickOn) releaseAll(); return; }

      const st = ctx.state;
      if (st !== 'playing' && st !== 'cutscene') {
        if (was.size || stickOn) releaseAll();
        if (!inMenu) { aWas = !!pad.buttons[0]?.pressed; startWas = !!pad.buttons[9]?.pressed; navWas = 0; }
        // Start still closes the pause screen
        const start = !!pad.buttons[9]?.pressed;
        if (start && !startWas && st === 'paused') { inp.inject('Escape', true); release.push('Escape'); }
        startWas = start;
        menu(pad, dt);
        inMenu = true;
        return;
      }
      if (inMenu) {
        // back from a menu: the A / Start that closed it is still down — not a jump / a new pause
        setFocus(null);
        was.set(0, !!pad.buttons[0]?.pressed);
        was.set(9, !!pad.buttons[9]?.pressed);
        inMenu = false;
      }

      for (const [i, code] of BUTTONS) {
        const b = pad.buttons[i];
        if (!b) continue;
        const on = b.pressed || b.value > 0.5;
        if (on === (was.get(i) ?? false)) continue;
        was.set(i, on);
        if (code === 'swap') { if (on) swap(); continue; }
        if (code === 'ShiftLeft' && sprintHeld) continue; // the stick holds it already
        inp.inject(code, on);
      }

      const mx = axis(pad.axes[0] ?? 0), my = axis(pad.axes[1] ?? 0);
      if (mx || my) {
        const len = Math.hypot(mx, my);
        const k = len > 1 ? 1 / len : 1;
        inp.injectStick(mx * k, my * k);
        stickOn = true;
      } else if (stickOn) { inp.injectStick(0, 0); stickOn = false; }
      const sprint = Math.hypot(mx, my) >= SPRINT_TILT && my < -0.75;
      if (sprint !== sprintHeld && !was.get(10)) { inp.inject('ShiftLeft', sprint); }
      sprintHeld = sprint;

      const lx = axis(pad.axes[2] ?? 0), ly = axis(pad.axes[3] ?? 0);
      if (lx || ly) {
        // squared response: fine aim near the centre, fast turns at the edge
        inp.injectLook(Math.sign(lx) * lx * lx * LOOK_PX * dt, Math.sign(ly) * ly * ly * LOOK_PX * LOOK_Y * dt);
      }
    },
  };
}
