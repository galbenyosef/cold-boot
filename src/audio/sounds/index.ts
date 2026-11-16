import type { SoundDef } from '../synth/core';
import { weaponSounds } from './weapons';
import { playerSounds } from './player';
import { worldSounds } from './world';
import { enemySounds } from './enemies';
import { loopSounds } from './loops';
import { musicSounds } from './music';
import { rev2Sounds } from './rev2';
import { rev4Sounds } from './rev4';
import { rev7Sounds } from './rev7';

export const ALL_SOUNDS: SoundDef[] = [...weaponSounds, ...playerSounds, ...worldSounds, ...enemySounds, ...loopSounds, ...musicSounds, ...rev2Sounds, ...rev4Sounds, ...rev7Sounds];

export const SOUND_MAP: ReadonlyMap<string, SoundDef> = new Map(ALL_SOUNDS.map((d) => [d.id, d]));
