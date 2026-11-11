/** Full-screen overlays: log reader, cinematic cards, pause, death, ending, resume gate. */
import type { GameContext, GameState } from '../core/types';
import type { StoryInternal } from './types';
import { SKIP_INTRO_KEY } from './types';
import { h, button, sfx, sleep, Typewriter, fmtTime, toggle, type Settings } from './dom';
import { settingsPanel, controlsPanel, GlitchTitle } from './menu';

// ───────────────────────────────────────────────────────────── log reader

export class LogReader {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private idEl: HTMLSpanElement;
  private meta: HTMLDListElement;
  private body: HTMLDivElement;
  private tw: Typewriter;
  private caret: HTMLElement | null;
  private openFor = 0;
  private resolve: (() => void) | null = null;
  private wheel = (e: WheelEvent) => { if (this.isOpen) this.body.scrollTop += e.deltaY; };
  private beepAcc = 0;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.root = h('div', 'layer ov logov hidden', parent);
    const log = this.panel = h('div', 'log', this.root);
    h('div', 'scanbar', log);
    const top = h('div', 'top', log);
    const rec = h('div', 'rec lbl', top);
    h('i', '', rec);
    h('span', '', rec, 'Recovered record');
    this.idEl = h('span', 'lbl', top, '');
    this.titleEl = h('h1', '', log, '');
    this.meta = h('dl', 'metab', log);
    this.body = h('div', 'body', log);
    this.tw = new Typewriter(this.body, 300, true);
    this.caret = this.body.querySelector('.caret');
    const bot = h('div', 'bot', log);
    const keys = h('div', 'keys lbl', bot);
    const k1 = h('span', '', keys); h('span', 'key', k1, 'E'); h('span', '', k1, 'Close');
    const k2 = h('span', '', keys); h('span', 'key', k2, 'W'); h('span', 'key', k2, 'S'); h('span', '', k2, 'Scroll');
    h('span', 'lbl', bot, 'HALCYON DYNAMICS · INTERNAL');
    addEventListener('wheel', this.wheel, { passive: true });
  }

  get isOpen(): boolean { return this.resolve !== null; }

  open(title: string, body: string): Promise<void> {
    if (this.resolve) this.close();
    // Header block: "KEY: value" lines up to the first blank line.
    const blocks = body.replace(/\r/g, '').split('\n\n');
    const head = blocks[0].split('\n');
    const isMeta = head.length > 0 && head.every((l) => /^[A-Z][A-Z .]{1,20}:\s/.test(l));
    this.meta.innerHTML = '';
    let text = body;
    if (isMeta) {
      for (const l of head) {
        const i = l.indexOf(':');
        h('dt', '', this.meta, l.slice(0, i));
        h('dd', '', this.meta, l.slice(i + 1).trim());
      }
      text = blocks.slice(1).join('\n\n');
    }
    toggle(this.meta, 'hidden', !isMeta);
    toggle(this.body, 'mono', /\.{4,}|^> /m.test(text));
    this.titleEl.textContent = title;
    this.idEl.textContent = 'REC ' + ((title.length * 7919 + text.length * 31) % 9000 + 1000).toString(16).toUpperCase();
    this.tw.start(text, 420);
    this.body.scrollTop = 0;
    this.openFor = 0;
    this.root.classList.remove('hidden');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    sfx(this.ctx, 'ui_open', 0.6);
    return new Promise((r) => { this.resolve = r; });
  }

  close(): void {
    const r = this.resolve;
    if (!r) return;
    this.resolve = null;
    this.root.classList.remove('show');
    sfx(this.ctx, 'ui_close', 0.6);
    setTimeout(() => { if (!this.resolve) this.root.classList.add('hidden'); }, 420);
    r();
  }

  update(dt: number): void {
    if (!this.resolve) return;
    const inp = this.ctx.input;
    this.openFor += dt;
    const before = this.tw.done;
    this.tw.update(dt);
    if (!this.tw.done) {
      this.beepAcc += dt;
      if (this.beepAcc > 0.09) { this.beepAcc = 0; }
      // Keep the caret in view while typing.
      if (this.caret) {
        const y = this.caret.offsetTop - this.body.offsetTop;
        if (y > this.body.scrollTop + this.body.clientHeight - 30) this.body.scrollTop = y - this.body.clientHeight + 60;
      }
    } else if (!before) { /* just finished */ }
    if (this.openFor < 0.3) return;
    if (inp.pressed('KeyE') || inp.pressed('Escape')) { this.close(); return; }
    if (!this.tw.done && (inp.pressed('Space') || inp.pressed('Enter') || inp.mousePressed(0))) this.tw.finish();
    const sc = (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0) - (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0);
    if (sc) this.body.scrollTop += sc * 520 * dt;
  }
}

// ───────────────────────────────────────────────────────────── cards

export class Cards {
  constructor(private ctx: GameContext, private parent: HTMLElement) {}

  async show(lines: string[], opts: { seconds?: number; skippable?: boolean; style?: 'intro' | 'title' | 'ending' } = {}): Promise<void> {
    const style = opts.style ?? 'intro';
    const root = h('div', `layer ov card card-${style} interactive grain`, this.parent);
    const stage = h('div', 'stage', root);
    const skip = opts.skippable !== false ? h('div', 'skip lbl', root, 'Space — skip') : null;
    let skipped = false;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') skipped = true; };
    const onClick = () => { skipped = true; };
    if (skip) { addEventListener('keydown', onKey); root.addEventListener('click', onClick); }
    void root.offsetWidth;
    root.classList.add('show');

    const wait = async (s: number) => {
      const end = performance.now() + s * 1000;
      while (!skipped && performance.now() < end) await sleep(0.05);
    };

    const els: HTMLElement[] = [];
    if (style === 'title') {
      els.push(h('div', 'big', stage, lines[0] ?? ''));
      els.push(h('div', 'rule', stage));
      for (const l of lines.slice(1)) els.push(h('div', 'ln', stage, l));
      const total = opts.seconds ?? 4.5;
      await wait(0.3);
      els.forEach((e) => e.classList.add('show'));
      skip?.classList.add('show');
      await wait(total);
    } else {
      stage.style.display = 'grid';
      stage.style.gap = style === 'ending' ? '26px' : '22px';
      for (const l of lines) els.push(h('div', 'ln', stage, l));
      els[els.length - 1]?.classList.add('last');
      const per = opts.seconds ? opts.seconds / (lines.length + 1) : 1.9;
      await wait(0.6);
      skip?.classList.add('show');
      for (const e of els) {
        if (skipped) break;
        e.classList.add('show');
        sfx(this.ctx, 'terminal_beep', 0.18);
        await wait(per);
      }
      await wait(style === 'ending' ? 2.5 : 1.8);
    }
    if (skip) { removeEventListener('keydown', onKey); }
    root.classList.add('fadeout');
    await sleep(skipped ? 0.5 : 1.2);
    root.remove();
  }
}

// ───────────────────────────────────────────────────────────── pause

export class PauseMenu {
  readonly root: HTMLDivElement;
  private meta: HTMLDivElement;
  private obj: HTMLDivElement;
  private side: HTMLDivElement;
  private hint: HTMLDivElement;
  private restartBtn: HTMLButtonElement;
  private confirmRestart = false;
  private prev: GameState = 'playing';
  open_ = false;
  /** Seconds the pointer-lock watchdog should hold off (lock requests are async). */
  grace = 0;

  constructor(private ctx: GameContext, settings: Settings, parent: HTMLElement, private roomName: () => string) {
    const root = this.root = h('div', 'layer ov pause scan hidden', parent);
    const col = h('div', 'col', root);
    h('div', 'lbl', col, 'Session suspended');
    h('h2', 'glow', col, 'PAUSED');
    this.meta = h('div', 'lbl meta', col, '');
    this.obj = h('div', 'obj', col, '');
    const items = h('div', 'items', col);
    button(ctx, items, 'Resume', '01', () => this.resume(), 'primary');
    this.restartBtn = button(ctx, items, 'Restart', '02', () => this.restart(), 'danger');
    this.side = h('div', 'side', root);
    settingsPanel(ctx, settings, this.side);
    h('div', '', this.side).style.height = '18px';
    controlsPanel(this.side);
    this.hint = h('div', 'hint lbl', root, 'Click Resume or press Esc to continue');
    root.addEventListener('click', (e) => { if (e.target === root) this.resume(); });
  }

  open(): void {
    if (this.open_) return;
    const s = this.ctx.state;
    if (s !== 'playing' && s !== 'cutscene') return;
    this.open_ = true;
    this.prev = s;
    this.ctx.setState('paused');
    try { this.ctx.audio.setMuffle(0.85); } catch { /* ignore */ }
    const obj = this.ctx.story?.objective ?? '';
    this.obj.innerHTML = '';
    if (obj) { h('b', 'lbl', this.obj, 'Objective'); this.obj.append(obj); }
    const t = (this.ctx.story as StoryInternal | undefined)?.stats?.time ?? this.ctx.time;
    this.meta.textContent = ['SUBLEVEL 3', this.roomName(), fmtTime(t)].filter(Boolean).join('  ·  ');
    this.confirmRestart = false;
    (this.restartBtn.lastChild as HTMLElement).textContent = 'Restart';
    this.hint.textContent = 'Click Resume or press Esc to continue';
    this.root.classList.remove('hidden');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    sfx(this.ctx, 'ui_open', 0.5);
  }

  resume(): void {
    if (!this.open_) return;
    if (!this.ctx.debug.autostart) this.ctx.input.requestPointerLock();
    this.grace = 1.2;
    this.open_ = false;
    try { this.ctx.audio.setMuffle(0); } catch { /* ignore */ }
    if (this.ctx.state === 'paused') this.ctx.setState(this.prev);
    this.root.classList.remove('show');
    sfx(this.ctx, 'ui_close', 0.5);
    setTimeout(() => { if (!this.open_) this.root.classList.add('hidden'); }, 500);
  }

  /** Pointer lock was refused (browser cooldown after Esc): stay paused and say so. */
  lockRefused(): void {
    this.hint.textContent = 'Pointer capture refused by the browser — click Resume again';
  }

  private restart(): void {
    if (!this.confirmRestart) {
      this.confirmRestart = true;
      (this.restartBtn.lastChild as HTMLElement).textContent = 'Restart — click to confirm';
      return;
    }
    try { sessionStorage.setItem(SKIP_INTRO_KEY, '1'); } catch { /* ignore */ }
    location.reload();
  }
}

// ───────────────────────────────────────────────────────────── death

export class DeathScreen {
  private root: HTMLDivElement | null = null;
  private tw: Typewriter | null = null;
  constructor(private ctx: GameContext, private parent: HTMLElement, private taunts: string[], private roomName: () => string) {}

  async show(): Promise<void> {
    if (this.root) return;
    const ctx = this.ctx;
    try { ctx.audio.setMuffle(0.6); } catch { /* ignore */ }
    ctx.input.exitPointerLock();
    await sleep(1.1);
    const root = this.root = h('div', 'layer ov death interactive grain scan', this.parent);
    const st = h('div', 'stage', root);
    h('div', 'lbl', st, 'Operator telemetry');
    h('h2', '', st, 'SIGNAL LOST');
    const t = (ctx.story as StoryInternal | undefined)?.stats?.time ?? ctx.time;
    h('div', 'lbl meta', st, ['REYES, S.', 'NO VITALS', this.roomName(), fmtTime(t)].filter(Boolean).join('  ·  '));
    const taunt = h('div', 'taunt', st);
    h('div', 'spk', taunt, 'CHOIR');
    const line = h('div', 'line', taunt);
    this.tw = new Typewriter(line, 30);
    const acts = h('div', 'acts', st);
    button(ctx, acts, 'Restart', '01', () => {
      try { sessionStorage.setItem(SKIP_INTRO_KEY, '1'); } catch { /* ignore */ }
      location.reload();
    }, 'primary');
    button(ctx, acts, 'Title screen', '02', () => location.reload());
    void root.offsetWidth;
    root.classList.add('show');
    await sleep(1.4);
    const text = this.taunts[(Math.random() * this.taunts.length) | 0] ?? '';
    this.tw.start(text, 26);
    try { ctx.audio.choirVoice(text, Math.max(2.5, text.length / 14)); } catch { /* ignore */ }
    await sleep(1.2);
    acts.classList.add('show');
  }

  update(dt: number): void { this.tw?.update(dt); }
}

// ───────────────────────────────────────────────────────────── ending

export class EndingScreen {
  private title: GlitchTitle | null = null;
  constructor(private ctx: GameContext, private parent: HTMLElement) {}

  async show(): Promise<void> {
    const ctx = this.ctx;
    ctx.input.exitPointerLock();
    const st = (ctx.story as StoryInternal | undefined)?.stats;
    const root = h('div', 'layer ov ending interactive grain', this.parent);
    const stage = h('div', 'stage', root);
    const eyebrow = h('div', 'lbl', stage, 'End of Sublevel 3');
    eyebrow.style.marginBottom = '30px';
    const tWrap = h('div', '', stage);
    this.title = new GlitchTitle(tWrap, 'COLD BOOT');
    const tbc = h('div', 'tbc', stage, 'TO BE CONTINUED');
    const stats = h('div', 'stats', stage);
    const stat = (label: string, value: string) => { const s = h('div', 'stat', stats); h('span', 'lbl', s, label); h('b', '', s, value); };
    stat('Time', fmtTime(st?.time ?? ctx.time));
    stat('Machines stopped', String(st?.kills ?? 0));
    stat('Records recovered', `${st?.logs ?? ctx.story?.logs.size ?? 0} / ${st?.logsTotal ?? 5}`);
    const acts = h('div', 'acts', stage);
    button(ctx, acts, 'Restart', '01', () => location.reload(), 'primary');
    const credit = h('div', 'lbl credit', stage, 'Every texture, mesh and sound in this game is generated in code');
    void root.offsetWidth;
    root.classList.add('show');
    const seq = [eyebrow, tWrap, tbc, stats, acts, credit];
    for (const [i, e] of seq.entries()) {
      await sleep(i === 0 ? 0.8 : i === 2 ? 1.6 : 0.9);
      e.classList.add('show');
    }
  }

  update(dt: number): void { this.title?.update(dt); }
}

// ───────────────────────────────────────────────────────────── resume gate (after death restart)

export function resumeGate(ctx: GameContext, parent: HTMLElement): Promise<void> {
  const root = h('div', 'layer ov gate interactive grain scan', parent);
  const st = h('div', 'stage', root);
  h('h2', 'glow', st, 'SIGNAL REACQUIRED');
  h('div', 'lbl', st, 'Click to resume  ·  Sublevel 3');
  void root.offsetWidth;
  root.classList.add('show');
  return new Promise((resolve) => {
    const go = () => {
      removeEventListener('keydown', onKey);
      try { void ctx.audio.unlock(); } catch { /* ignore */ }
      if (!ctx.debug.autostart) ctx.input.requestPointerLock();
      sfx(ctx, 'ui_click', 0.6);
      root.classList.remove('show');
      setTimeout(() => root.remove(), 600);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Enter' || e.code === 'Space') go(); };
    root.addEventListener('click', go, { once: true });
    addEventListener('keydown', onKey);
  });
}
