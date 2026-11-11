// STUB — replaced by the audio task.
import type { AudioSystem, GameContext } from '../core/types';

export async function createAudio(_ctx: GameContext): Promise<AudioSystem> {
  const handle = { setVolume() {}, setPosition() {}, stop() {} };
  return {
    async unlock() {}, play() {}, loop() { return handle; }, setMusic() {}, setRoom() {}, choirVoice() {},
    setMasterVolume() {}, setMuffle() {}, update() {},
  };
}
