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
import { rev9Sounds } from './rev9';
import { rev10Sounds } from './rev10';
import { rev11Sounds } from './rev11';

export const ALL_SOUNDS: SoundDef[] = [...weaponSounds, ...playerSounds, ...worldSounds, ...enemySounds, ...loopSounds, ...musicSounds, ...rev2Sounds, ...rev4Sounds, ...rev7Sounds, ...rev9Sounds, ...rev10Sounds, ...rev11Sounds];

export const SOUND_MAP: ReadonlyMap<string, SoundDef> = new Map(ALL_SOUNDS.map((d) => [d.id, d]));
