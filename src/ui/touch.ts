/**
 * On-screen touch controls (phones / tablets — `ctx.input.touchMode`, set from `DebugFlags.mobile`).
 *
 * Everything goes through `Input.inject` / `injectLook`, i.e. the same codes the keyboard and mouse produce, so the
 * player, weapons, grips, keypad and story code need no touch paths of their own.
 *
 *   play     left half: floating analog stick (Input.injectStick; full tilt forward = sprint); right half: drag to look;
 *            buttons: FIRE (hold; dragging it also looks), AIM (toggle), USE (E, hold), RELOAD, JUMP, CROUCH,
 *            LIGHT, weapon swap, RADIO (Q, levels 5–6), pause (Esc)
 *   cutscene SKIP (hold Space) and pause
 *   modal    note / log / keypad open: a close button (Esc); a tap finishes / closes a note (Mouse0); dragging scrolls a log
 *   hidden   menu, pause, death, ending, loading — those screens are tapped directly
 */
import type { GameContext, WeaponId } from '../core/types';
import { h } from './dom';

/** Touch pixels → mouse pixels for looking (the player's SENSITIVITY is tuned for a mouse). */
const LOOK_GAIN = 1.6;
/** Joystick travel radius (CSS px) and the per-axis tilt that holds a direction key. */
const STICK_R = 54;
/** Tilt below this (of STICK_R) is ignored; above it the stick is analog. */
const STICK_DEAD = 0.12;
/** Tilt past this, pushed forward, also holds sprint. */
const SPRINT_TILT = 0.93;
const WEAPON_ORDER: readonly WeaponId[] = ['pistol', 'shotgun', 'carbine'];

export type TouchModal = 'note' | 'log' | 'keypad' | null;

export interface TouchHooks {
  /** Which modal UI (if any) is open over play. */
  modal(): TouchModal;
}

type Mode = 'play' | 'cutscene' | 'modal' | 'hidden';

export class TouchControls {
  readonly root: HTMLDivElement;
  private mode: Mode = 'hidden';
  private modal: TouchModal = null;
  private readonly play: HTMLDivElement;
  private readonly cut: HTMLDivElement;
  private readonly modalBar: HTMLDivElement;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private readonly radioBtn: HTMLElement;
  private readonly aimBtn: HTMLElement;
  private readonly swapBtn: HTMLElement;
  private readonly useBtn: HTMLElement;
  private readonly reloadBtn: HTMLElement;
  private readonly fireBtn: HTMLElement;
  private readonly pad: HTMLDivElement;
  private readonly leftFire: HTMLElement;
  /** Taps release on the next update (so `pressed` and `down` both see them for a frame). */
  private releaseNext: string[] = [];
  private aimOn = false;
  private stickId: number | null = null;
  private stickO = { x: 0, y: 0 };
  private stickKeys = new Set<string>();
  /** Active look drags: pointerId → last position. */
  private looks = new Map<number, { x: number; y: number }>();
  /** Log scrolling drag (modal 'log'). */
  private scrollY: number | null = null;
  private unlocked = false;
  private syncT = 0;

  constructor(private readonly ctx: GameContext, parent: HTMLElement, private readonly hooks: TouchHooks) {
    const root = (this.root = h('div', 'touch hidden', parent));
    // stop iOS gestures (double-tap zoom, pinch, edge scroll) from reaching the page
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick'] as const) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

    // ── play
    // a phone held upright: the game is played sideways
    h('div', 't-rotate', root, 'ROTATE TO LANDSCAPE');
    const play = (this.play = h('div', 't-play', root));
    const move = h('div', 't-zone t-move', play);
    const look = h('div', 't-zone t-look', play);
    this.stickBase = h('div', 't-stick hidden', play);
    this.stickKnob = h('div', 't-knob', this.stickBase);
    this.bindStick(move);
    this.bindLook(look);
    // second trigger on the left (as in CoD Mobile): the left thumb fires while the right one keeps aiming
    this.leftFire = this.button(play, 't-fire2', 'FIRE', 'Mouse0', 'hold', false);

    // the always-there buttons sit in a tight cluster round FIRE; the ones that come and go (AIM: carbine only, USE:
    // something to use, SWAP: two weapons or more, RADIO: levels 5–6) sit on its outside, so hiding them leaves no hole
    const pad = (this.pad = h('div', 't-pad', play));
    this.fireBtn = this.button(pad, 't-fire', 'FIRE', 'Mouse0', 'hold', true);
    this.reloadBtn = this.button(pad, 't-reload', 'RLD', 'KeyR', 'tap');
    this.button(pad, 't-jump', 'JUMP', 'Space', 'hold');
    this.button(pad, 't-crouch', 'CROUCH', 'KeyC', 'tap');
    this.button(pad, 't-light', 'LIGHT', 'KeyF', 'tap');
    this.aimBtn = this.button(pad, 't-aim', 'AIM', 'Mouse2', 'toggle');
    this.useBtn = this.button(pad, 't-use', 'USE', 'KeyE', 'hold', true);
    this.swapBtn = this.button(pad, 't-swap', 'SWAP', '', 'swap');
    this.radioBtn = this.button(pad, 't-radio', 'RADIO', 'KeyQ', 'tap');
    this.button(play, 't-pause', 'II', 'Escape', 'tap');

    // ── cutscene
    const cut = (this.cut = h('div', 't-cut hidden', root));
    this.button(cut, 't-skip', 'HOLD TO SKIP', 'Space', 'hold');
    this.button(cut, 't-pause', 'II', 'Escape', 'tap');

    // ── modal (note / log / keypad)
    const mb = (this.modalBar = h('div', 't-modal hidden', root));
    this.button(mb, 't-close', '✕', 'Escape', 'tap');
    // a tap anywhere finishes / closes a note (its own Mouse0 handling); a drag scrolls an open log
    document.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'modal') return;
      if (this.modal === 'note' && !(e.target as HTMLElement).closest('.t-close')) this.tap('Mouse0');
      if (this.modal === 'log') this.scrollY = e.clientY;
    });
    document.addEventListener('pointermove', (e) => {
      if (this.mode !== 'modal' || this.modal !== 'log' || this.scrollY === null) return;
      const d = this.scrollY - e.clientY;
      this.scrollY = e.clientY;
      if (d) dispatchEvent(new WheelEvent('wheel', { deltaY: d * 1.4 })); // LogReader scrolls on window wheel
    });
    const endScroll = () => { this.scrollY = null; };
    document.addEventListener('pointerup', endScroll);
    document.addEventListener('pointercancel', endScroll);
    // the app going to the background must not leave a key held
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  /** Per frame (from ui.update). */
  update(dt: number): void {
    const inp = this.ctx.input;
    for (const c of this.releaseNext) inp.inject(c, false);
    this.releaseNext.length = 0;

    const s = this.ctx.state;
    const modal = this.hooks.modal();
    const mode: Mode = s === 'playing' ? (modal ? 'modal' : 'play') : s === 'cutscene' ? 'cutscene' : 'hidden';
    if (mode !== this.mode || modal !== this.modal) {
      if (mode !== 'play') this.releaseAll();
      this.mode = mode;
      this.modal = modal;
      this.root.classList.toggle('hidden', mode === 'hidden');
      this.root.style.zIndex = mode === 'modal' ? '12' : '';
      this.play.classList.toggle('hidden', mode !== 'play');
      this.cut.classList.toggle('hidden', mode !== 'cutscene');
      this.modalBar.classList.toggle('hidden', mode !== 'modal');
    }

    if (this.mode === 'play') {
      const pl = this.ctx.player;
      // USE follows the HUD's interaction prompt (and an active grip) every frame; never vanishes under a finger
      const useNow = !!(pl?.focus?.enabled) || (pl?.gripProgress ?? -1) >= 0 || this.useBtn.classList.contains('down');
      this.show(this.useBtn, useNow);
      if ((this.syncT -= dt) <= 0) {
        this.syncT = 0.2;
        const owned = pl ? WEAPON_ORDER.filter((w) => pl.weapons?.[w]?.owned) : [];
        const cur = pl?.currentWeapon ?? null;
        this.pad.classList.toggle('unarmed', !cur);
        this.show(this.fireBtn, !!cur);
        this.show(this.leftFire, !!cur);
        this.show(this.reloadBtn, !!cur);
        this.show(this.aimBtn, cur === 'carbine' || this.aimOn);
        this.show(this.swapBtn, owned.length >= 2 || (owned.length === 1 && !cur));
        this.show(this.radioBtn, this.ctx.levelId >= 5);
        if (cur !== 'carbine' && this.aimOn) { this.aimOn = false; inp.inject('Mouse2', false); this.aimBtn.classList.remove('on'); this.show(this.aimBtn, false); }
      }
    }
  }

  // ───────────────────────── buttons

  private show(b: HTMLElement, on: boolean): void {
    if (b.classList.contains('hidden') === !on) return;
    b.classList.toggle('hidden', !on);
  }

  private button(parent: HTMLElement, cls: string, label: string, code: string, kind: 'hold' | 'tap' | 'toggle' | 'swap', looks = false): HTMLElement {
    const b = h('div', `t-btn ${cls}`, parent, label);
    let id: number | null = null;
    let last = { x: 0, y: 0 };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.unlockAudio();
      if (id !== null) return;
      id = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      b.classList.add('down');
      if (kind === 'hold') this.hold(code, 1);
      else if (kind === 'tap') this.tap(code);
      else if (kind === 'toggle') {
        this.aimOn = !this.aimOn;
        this.ctx.input.inject(code, this.aimOn);
        b.classList.toggle('on', this.aimOn);
      } else this.swapWeapon();
    }, { passive: false });
    b.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || !looks) return;
      this.ctx.input.injectLook((e.clientX - last.x) * LOOK_GAIN, (e.clientY - last.y) * LOOK_GAIN);
      last = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      b.classList.remove('down');
      if (kind === 'hold') this.hold(code, -1);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    return b;
  }

  /** Several buttons can hold one code (two FIRE buttons): it is released when the last lets go. */
  private holds = new Map<string, number>();
  private hold(code: string, d: number): void {
    const n = Math.max(0, (this.holds.get(code) ?? 0) + d);
    this.holds.set(code, n);
    this.ctx.input.inject(code, n > 0);
  }

  private tap(code: string): void {
    this.ctx.input.inject(code, true);
    this.releaseNext.push(code);
  }

  /** Next owned weapon after the one in hand (Digit1…3 — the player's own slot keys). */
  private swapWeapon(): void {
    const pl = this.ctx.player;
    if (!pl) return;
    const owned = WEAPON_ORDER.filter((w) => pl.weapons?.[w]?.owned);
    if (!owned.length) return;
    const i = pl.currentWeapon ? owned.indexOf(pl.currentWeapon) : -1;
    const next = owned[(i + 1) % owned.length];
    this.tap(`Digit${WEAPON_ORDER.indexOf(next) + 1}`);
  }

  // ───────────────────────── stick

  private bindStick(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.unlockAudio();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.stickO = { x: e.clientX, y: e.clientY };
      this.stickBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stickKnob.style.transform = 'translate(0px, 0px)';
      this.stickBase.classList.remove('hidden');
    }, { passive: false });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let vx = (e.clientX - this.stickO.x) / STICK_R, vy = (e.clientY - this.stickO.y) / STICK_R;
      const len = Math.hypot(vx, vy);
      if (len > 1) { vx /= len; vy /= len; }
      this.stickKnob.style.transform = `translate(${(vx * STICK_R).toFixed(1)}px, ${(vy * STICK_R).toFixed(1)}px)`;
      // analog: a small tilt walks slowly; a dead zone near the centre; full tilt forward also sprints
      const m = Math.min(1, len), k = m < STICK_DEAD ? 0 : (m - STICK_DEAD) / (1 - STICK_DEAD) / (m || 1);
      this.ctx.input.injectStick(vx * k, vy * k);
      this.setStick(len >= SPRINT_TILT && vy < -0.75 ? new Set(['ShiftLeft']) : new Set());
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickBase.classList.add('hidden');
      this.ctx.input.injectStick(0, 0);
      this.setStick(new Set());
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  private setStick(want: Set<string>): void {
    for (const k of this.stickKeys) if (!want.has(k)) this.ctx.input.inject(k, false);
    for (const k of want) if (!this.stickKeys.has(k)) this.ctx.input.inject(k, true);
    this.stickKeys = want;
  }

  // ───────────────────────── look

  private bindLook(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.unlockAudio();
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }, { passive: false });
    zone.addEventListener('pointermove', (e) => {
      const p = this.looks.get(e.pointerId);
      if (!p) return;
      this.ctx.input.injectLook((e.clientX - p.x) * LOOK_GAIN, (e.clientY - p.y) * LOOK_GAIN);
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e: PointerEvent) => { this.looks.delete(e.pointerId); };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
  }

  // ───────────────────────── housekeeping

  private releaseAll(): void {
    const inp = this.ctx.input;
    this.setStick(new Set());
    inp.injectStick(0, 0);
    this.stickId = null;
    this.stickBase.classList.add('hidden');
    this.looks.clear();
    this.holds.clear();
    for (const c of ['Mouse0', 'KeyE', 'Space', 'KeyR', 'KeyC', 'KeyF', 'KeyQ', 'Escape', 'Digit1', 'Digit2', 'Digit3']) inp.inject(c, false);
    for (const b of this.root.querySelectorAll('.t-btn.down')) b.classList.remove('down');
    // aim stays toggled across a note / cutscene only if still in play; leaving play drops it
    if (this.aimOn) { this.aimOn = false; inp.inject('Mouse2', false); this.aimBtn.classList.remove('on'); }
  }

  /** Web Audio on iOS starts only inside a user gesture: the first touch on the controls does it. */
  private unlockAudio(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    try { void this.ctx.audio?.unlock(); } catch { /* ignore */ }
  }
}

/** Styles for the touch layer (appended to the UI stylesheet). Sits above the HUD, below notes / keypad / menus. */
export const TOUCH_CSS = `
.cb .touch { position: absolute; inset: 0; z-index: 4; pointer-events: none; touch-action: none; }
.cb .touch .t-play, .cb .touch .t-cut, .cb .touch .t-modal { position: absolute; inset: 0; pointer-events: none; }
.cb .touch .t-zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; touch-action: none; }
.cb .touch .t-move { left: 0; width: 45%; }
.cb .touch .t-look { left: 45%; right: 0; }
.cb .touch .t-stick { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.cb .touch .t-stick::before { content: ''; position: absolute; left: -${STICK_R + 6}px; top: -${STICK_R + 6}px;
  width: ${(STICK_R + 6) * 2}px; height: ${(STICK_R + 6) * 2}px; border-radius: 50%;
  border: 1px solid rgba(160,220,255,.28); background: rgba(10,20,28,.18); }
.cb .touch .t-knob { position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%;
  background: rgba(160,220,255,.22); border: 1px solid rgba(160,220,255,.5); }
.cb .touch .t-btn { position: absolute; pointer-events: auto; touch-action: none; display: grid; place-items: center;
  width: 58px; height: 58px; border-radius: 50%; border: 1px solid rgba(160,220,255,.32); background: rgba(10,20,28,.28);
  color: rgba(214,236,250,.78); font: 600 9px/1 var(--f-mono); letter-spacing: .14em; text-align: center;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
.cb .touch .t-btn.down { background: rgba(116,228,255,.28); border-color: rgba(116,228,255,.8); color: #fff; }
.cb .touch .t-btn.on { background: rgba(255,178,74,.22); border-color: rgba(255,178,74,.8); color: #ffd9a6; }
.cb .touch .t-pad { position: absolute; right: calc(env(safe-area-inset-right) + 14px); bottom: calc(env(safe-area-inset-bottom) + 14px);
  width: 236px; height: 236px; pointer-events: none; }
/* core cluster: FIRE in the corner, RLD above it, JUMP left of it, CROUCH in the elbow, LIGHT above RLD */
.cb .touch .t-fire { right: 0; bottom: 0; width: 84px; height: 84px; font-size: 11px; border-color: rgba(255,120,110,.5); }
.cb .touch .t-reload { right: 13px; bottom: 94px; }
.cb .touch .t-jump { right: 94px; bottom: 13px; }
.cb .touch .t-crouch { right: 86px; bottom: 86px; width: 54px; height: 54px; }
.cb .touch .t-light { right: 17px; bottom: 160px; width: 50px; height: 50px; }
/* outer ring (come and go): AIM left of JUMP, USE left of CROUCH, SWAP next to LIGHT, RADIO above USE */
.cb .touch .t-aim { right: 160px; bottom: 13px; }
.cb .touch .t-use { right: 142px; bottom: 82px; width: 68px; height: 68px; border-color: rgba(116,228,255,.7);
  background: rgba(116,228,255,.14); color: #e8fbff; }
.cb .touch .t-swap { right: 80px; bottom: 148px; width: 50px; height: 50px; }
.cb .touch .t-radio { right: 150px; bottom: 160px; width: 50px; height: 50px; }
/* unarmed (no FIRE / RLD): JUMP takes the corner, CROUCH above it, USE beside it, LIGHT on top, SWAP (to draw) in the elbow */
.cb .touch .t-pad.unarmed .t-jump { right: 8px; bottom: 8px; width: 66px; height: 66px; }
.cb .touch .t-pad.unarmed .t-crouch { right: 14px; bottom: 88px; }
.cb .touch .t-pad.unarmed .t-light { right: 16px; bottom: 156px; }
.cb .touch .t-pad.unarmed .t-use { right: 88px; bottom: 6px; }
.cb .touch .t-pad.unarmed .t-swap { right: 86px; bottom: 90px; }
.cb .touch .t-pad.unarmed .t-radio { right: 86px; bottom: 156px; }
.cb .touch .t-fire2 { left: calc(env(safe-area-inset-left) + 26px); top: 40%; width: 64px; height: 64px; font-size: 10px;
  border-color: rgba(255,120,110,.45); }
.cb .touch .t-pause { right: calc(env(safe-area-inset-right) + 14px); top: calc(env(safe-area-inset-top) + 12px); width: 42px; height: 42px; font-size: 12px; }
.cb .touch .t-skip { left: 50%; bottom: calc(env(safe-area-inset-bottom) + 24px); transform: translateX(-50%);
  width: 150px; height: 46px; border-radius: 23px; }
.cb .touch .t-close { right: calc(env(safe-area-inset-right) + 14px); top: calc(env(safe-area-inset-top) + 12px); width: 46px; height: 46px; font-size: 18px; z-index: 20; }
.cb .touch .t-modal { z-index: 20; }
/* touch play: the weapon / ammo block moves to the top right (under pause) — the bottom right is the button pad */
.cb.touchmode .weapon { right: calc(env(safe-area-inset-right) + 70px); top: calc(env(safe-area-inset-top) + 14px); bottom: auto; transform: scale(.72); transform-origin: top right; }
.cb.touchmode .weapon.off { transform: scale(.72) translateY(-8px); }
.cb .touch .t-rotate { display: none; }
@media (orientation: portrait) and (max-width: 600px) {
  .cb .touch .t-rotate { display: grid; place-items: center; position: absolute; inset: 0; z-index: 30; pointer-events: auto;
    background: rgba(0,0,0,.92); color: var(--fg-2); font: 500 11px/1 var(--f-mono); letter-spacing: .34em; }
}
/* short screens (a phone held sideways): a smaller pad */
@media (max-height: 520px) {
  .cb .touch .t-pad { transform: scale(.78); transform-origin: bottom right; }
}
`;
