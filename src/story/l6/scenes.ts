/**
 * Level 6 — the ending (stage 3d §4.9, §8.9; D16, D17): the first-person cutscene at the dock console, E1 (the manifest)
 * and E2 (the empty cradle on the live feed), then CHOIR's last line and `l6_end`. **ST-b's file.** This is ST-a's STUB:
 * the interface the route and the hooks call. `sceneLines()` lists every line the scene may say (preloaded from
 * `l6_quiet`, `linesReady`); `runEnding()` is called when `console6` is used with the ending pending.
 *
 * What ST-b fills: `runEnding()` (the shot table on `rig.cutscene`, every line on its cue from recorded durations, each
 * beat ≤ 25 s, the feed / cctv fallback, the OSD with `launchAt`), `endingTimes` / `endingResult`, and overrides of
 * `bossFacts().inEnding` while it runs.
 */
import { Boss6 } from './boss';

export abstract class Scenes6 extends Boss6 {
  protected endingTimes: Record<string, number> | null = null;
  protected endingResult: 'played' | 'skipped' | null = null;

  /** Every line the ending may say (both variants). */
  protected sceneLines(): string[] {
    return [
      'l6_kes_end_1', 'l6_kes_end_1b', 'l6_sunde_end_1', 'l6_sunde_end_2', 'l6_reyes_end', 'l6_kes_end_2', 'l6_kes_end_3',
      'l6_kes_end_4', 'l6_kes_end_4b', 'l6_choir_last_stop', 'l6_choir_last_command',
    ];
  }
  /** The ending (ST-b). Stub: straight to the chapter end. */
  protected async runEnding(): Promise<void> {
    if (this.f.ending) return;
    this.f.ending = true;
    this.endingResult = 'skipped';
    this.beat('l6_end');
    await this.hooks.end();
  }
}
