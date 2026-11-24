import type { Input } from './types';

export function createInput(canvas: HTMLCanvasElement): Input {
  const held = new Set<string>();
  const justPressed = new Set<string>();
  const mouseHeld = new Set<number>();
  const mouseJust = new Set<number>();
  let dx = 0, dy = 0, wheel = 0;
  let locked = false;
  let touchMode = false;
  const stick = { x: 0, y: 0 };
  /** Virtual (touch) holds, kept apart from the real keyboard so a key-up never cancels a held on-screen button. */
  const vKeys = new Set<string>();
  const vMouse = new Set<number>();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) justPressed.add(e.code);
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); mouseHeld.clear(); });
  window.addEventListener('mousedown', (e) => { mouseHeld.add(e.button); mouseJust.add(e.button); });
  window.addEventListener('mouseup', (e) => mouseHeld.delete(e.button));
  window.addEventListener('mousemove', (e) => {
    if (!locked) return;
    // Guard against the occasional huge spurious delta some browsers report on lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    dx += e.movementX; dy += e.movementY;
  });
  window.addEventListener('wheel', (e) => { wheel = Math.sign(e.deltaY); }, { passive: true });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) { held.clear(); mouseHeld.clear(); }
  });

  return {
    down: (c) => held.has(c) || vKeys.has(c),
    pressed: (c) => justPressed.has(c),
    mouseDown: (b) => mouseHeld.has(b) || vMouse.has(b),
    mousePressed: (b) => mouseJust.has(b),
    get mouseDX() { return dx; },
    get mouseDY() { return dy; },
    get wheel() { return wheel; },
    get pointerLocked() { return locked || touchMode; },
    get touchMode() { return touchMode; },
    set touchMode(v: boolean) { touchMode = v; if (!v) { vKeys.clear(); vMouse.clear(); stick.x = stick.y = 0; } },
    inject(code: string, down: boolean) {
      const m = /^Mouse(\d)$/.exec(code);
      if (m) {
        const b = +m[1];
        if (down) { if (!vMouse.has(b)) mouseJust.add(b); vMouse.add(b); } else vMouse.delete(b);
        return;
      }
      if (down) { if (!vKeys.has(code)) justPressed.add(code); vKeys.add(code); } else vKeys.delete(code);
    },
    injectLook(ddx: number, ddy: number) { dx += ddx; dy += ddy; },
    get stick() { return stick; },
    injectStick(x: number, y: number) { stick.x = x; stick.y = y; },
    requestPointerLock() {
      if (touchMode) return;
      // Both the options form and the plain form may return a promise that rejects (no user gesture,
      // headless, user pressed Esc too recently) — swallow every rejection.
      const plain = () => {
        try {
          const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          if (p && p.catch) p.catch(() => { /* ignore */ });
        } catch { /* ignore */ }
      };
      try {
        const p = (canvas as any).requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(plain);
      } catch { plain(); }
    },
    exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    endFrame() { justPressed.clear(); mouseJust.clear(); dx = 0; dy = 0; wheel = 0; },
  };
}
