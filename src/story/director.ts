/**
 * Music director — the only place the story calls `audio.setMusic`.
 *
 * The audio module layers combat on top by itself (switches to 'combat' while enemies are active when the
 * requested state is ambient/tension, holds 'aftermath', then returns to the request — see
 * src/audio/SOUNDS.md). So the story only sets the baseline *mood*. Revision 2: the long opening is
 * 'silence' / 'ambient', 'tension' only from the fab reveal, and 'silence' is used on purpose just before
 * a scare (the script guards against 'silence' outlasting a fight); `hard()` is for explicit overrides
 * (e.g. silence for the descent) after which moods are ignored.
 */
import type { GameContext, MusicState } from '../core/types';

export class MusicDirector {
  private _mood: MusicState = 'ambient';
  private current: MusicState | null = null;
  private locked = false;

  constructor(private ctx: GameContext) {}

  setMood(m: MusicState): void { this._mood = m; }
  /** The requested baseline mood (the audio module layers combat/aftermath on top by itself). */
  get mood(): MusicState { return this._mood; }
  get state(): MusicState | null { return this.current; }

  /** Hard override (descent → silence); the director stops following moods afterwards. */
  hard(m: MusicState): void {
    this.locked = true;
    this.apply(m);
  }

  update(_dt: number): void {
    const s = this.ctx.state;
    if (this.locked || (s !== 'playing' && s !== 'cutscene')) return;
    this.apply(this._mood);
  }

  private apply(m: MusicState): void {
    if (m === this.current) return;
    this.current = m;
    try { this.ctx.audio.setMusic(m); } catch (e) { console.error('[story] setMusic failed', e); }
  }
}
