import type { SoundDef } from '../synth/core';
import { weaponSounds } from './weapons';
import { playerSounds } from './player';
import { worldSounds } from './world';
import { enemySounds } from './enemies';
import { loopSounds } from './loops';
import { musicSounds } from './music';

export const ALL_SOUNDS: SoundDef[] = [...weaponSounds, ...playerSounds, ...worldSounds, ...enemySounds, ...loopSounds, ...musicSounds];

export const SOUND_MAP: ReadonlyMap<string, SoundDef> = new Map(ALL_SOUNDS.map((d) => [d.id, d]));
