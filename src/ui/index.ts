// STUB — replaced by the ui task.
import type { GameContext, UISystem } from '../core/types';

export async function createUI(ctx: GameContext): Promise<UISystem> {
  return {
    showMenu: () => new Promise<void>((resolve) => {
      const b = document.createElement('button');
      b.textContent = 'START';
      b.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:auto;font:20px monospace;padding:12px 32px';
      b.onclick = () => { b.remove(); ctx.audio.unlock(); ctx.input.requestPointerLock(); resolve(); };
      ctx.uiRoot.appendChild(b);
    }),
    async showCard() {}, async showLog() {}, async showDeath() {}, async showEnding() {}, setHudVisible() {}, update() {},
  };
}
