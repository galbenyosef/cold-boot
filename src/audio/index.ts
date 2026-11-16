/**
 * COLD BOOT audio. Everything is synthesised: one-shots are pre-rendered offline at load
 * (see sounds/*), loops/music/voice are generative. Subscribes to game events itself — see SOUNDS.md.
 */
import * as THREE from 'three';
import type { AudioSystem, EnemyType, GameContext, LoopHandle, MusicState, PlayOpts, Surface, VoiceHandle } from '../core/types';
import { AudioEngine, type LoopVoice } from './engine';
import { Music, type MusicMode } from './music';
import { Ambience } from './ambient';
import { renderChoir } from './choir';
import { VoiceBank } from './voice';
import { levelOf } from '../core/progress';

export interface AudioDebug {
  engine: AudioEngine;
  music: Music;
  ambience: Ambience;
  voice: VoiceBank;
  preRenderMs: number;
  /** Effective music mode (after auto-combat / menu logic). */
  readonly musicMode: MusicMode;
}

const STEP_ID: Record<Surface, string> = {
  metal: 'step_metal', concrete: 'step_concrete', rubber: 'step_rubber', glass: 'step_glass', robot: 'step_metal', flesh: 'step_rubber',
};
const IMPACT_ID: Record<Surface, string> = {
  metal: 'impact_metal', concrete: 'impact_concrete', rubber: 'impact_rubber', glass: 'impact_glass', robot: 'impact_robot', flesh: 'impact_flesh',
};
const ENEMY_Y: Record<EnemyType, number> = { skitter: 0.35, husk: 1.4, sentry: 0, foreman: 1.9 };
const GRATE_ROOMS = new Set(['corr_a', 'elevator']);

function silentVoice(duration: number): VoiceHandle {
  return { duration, done: new Promise<void>((r) => setTimeout(r, duration * 1000)), setPosition() {}, stop() {} };
}

function stubAudio(): AudioSystem {
  const handle: LoopHandle = { setVolume() {}, setPosition() {}, stop() {} };
  return {
    async unlock() {}, play() {}, loop() { return handle; }, setMusic() {}, setRoom() {}, choirVoice() {},
    say() { return silentVoice(2.5); }, async preloadVoice() {},
    setMasterVolume() {}, setMuffle() {}, update() {},
  };
}

export async function createAudio(ctx: GameContext): Promise<AudioSystem> {
  let eng: AudioEngine;
  try {
    eng = new AudioEngine();
  } catch (e) {
    console.warn('[audio] Web Audio unavailable — running silent', e);
    return stubAudio();
  }
  await eng.preload();
  if (ctx.debug?.verbose) console.info(`[audio] pre-rendered load set in ${eng.preRenderMs.toFixed(0)} ms`);
  // the rest renders in the background once loading has moved on
  setTimeout(() => { eng.renderIdle(); }, 200);

  const music = new Music(eng.ctx, eng.buses.music, eng.plateIn, (id) => eng.buffers(id));
  const amb = new Ambience(eng);
  const voice = new VoiceBank(eng);
  // levels after the first start powered (level 2: the hall is held, not dead) — LEVELS[id].powerOnAtLoad
  const level = levelOf(ctx);
  if (level.powerOnAtLoad) amb.powerOn = true;
  // this level's voice files: fetch the bytes in the background (decode stays lazy)
  setTimeout(() => { try { voice.prefetchLevel(level.id); } catch { /* ignore */ } }, 1500);
  const musicTimer = setInterval(() => { if (eng.running) music.tick(); }, 100);
  void musicTimer;

  // physics line of sight, lazily (physics exists before audio, but be defensive)
  eng.los = (a, b) => (ctx.physics ? ctx.physics.lineOfSight(a, b) : true);

  // ───────────── state
  let requested: MusicMode = 'silence';
  let effective: MusicMode = 'silence';
  let requestedAt = 0;
  let menuSince = -1;
  let userMuffle = 0, stateMuffle = 0, concussion = 0;
  let activeFor = 0, quietFor = 0, autoCombat = false, aftermathUntil = 0;
  let roomTimer = 0, roomCandidate = '', roomStable = 0;
  let musicTimerAcc = 0;
  let nextBeat = 0;
  let tinnitus: LoopVoice | null = null;
  let bedStarted = false;

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

  const playerPos = (): THREE.Vector3 | null => (ctx.player ? ctx.player.position : null);

  /** Position near the player's feet, offset to the right of the view (ejected brass). */
  const besidePlayer = (out: THREE.Vector3, side: number, fwd: number) => {
    const p = ctx.player;
    if (!p) return null;
    const f = p.forward;
    const len = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / len, fz = f.z / len;
    out.set(p.position.x - fz * side + fx * fwd, p.position.y + 0.02, p.position.z + fx * side + fz * fwd);
    return out;
  };

  const lift = (p: THREE.Vector3, y: number, out = tmpA) => out.set(p.x, p.y + y, p.z);

  // ───────────── public API
  const sys: AudioSystem & { debug: AudioDebug } = {
    async unlock() {
      try {
        if (eng.ctx.state !== 'running') await eng.ctx.resume();
        // iOS/Safari: a silent buffer from inside the gesture
        const b = eng.ctx.createBuffer(1, 1, eng.ctx.sampleRate);
        const s = eng.ctx.createBufferSource(); s.buffer = b; s.connect(eng.ctx.destination); s.start();
      } catch (e) {
        console.warn('[audio] unlock failed', e);
      }
    },
    play(id: string, opts?: PlayOpts) {
      eng.play(id, opts ? { position: opts.position, volume: opts.volume, pitch: opts.pitch } : undefined);
    },
    loop(id: string, opts?: PlayOpts): LoopHandle {
      return eng.loop(id, opts ? { position: opts.position, volume: opts.volume, pitch: opts.pitch } : {});
    },
    setMusic(state: MusicState) {
      requested = state;
      requestedAt = eng.now;
      if (state === 'combat' || state === 'silence') { autoCombat = false; aftermathUntil = 0; }
      refreshMusic();
    },
    setRoom(room: string) {
      roomCandidate = room; roomStable = 0;
      applyRoom(room);
    },
    choirVoice(text: string, duration: number) {
      if (!eng.running) return;
      const asked = eng.now;
      renderChoir(text, duration).then((buf) => {
        if (eng.now - asked > 0.6) return; // too late to be in sync with the subtitle
        const c = eng.ctx;
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain(); g.gain.value = 0.9;
        const send = c.createGain(); send.gain.value = 0.75;
        src.connect(g); g.connect(eng.buses.voice); g.connect(send); send.connect(eng.plateIn);
        const release = voice.duck(1);
        src.onended = () => {
          src.disconnect(); g.disconnect(); send.disconnect();
          release();
        };
        src.start();
      }).catch((e) => console.warn('[audio] choir render failed', e));
    },
    say(id: string, opts?: PlayOpts): VoiceHandle {
      return voice.say(id, opts);
    },
    preloadVoice(idsOrPrefixes: string[]): Promise<void> {
      try { return voice.preload(idsOrPrefixes); } catch { return Promise.resolve(); }
    },
    setMasterVolume(v: number) { eng.setMaster(v); },
    setMuffle(amount: number) { userMuffle = Math.max(0, Math.min(1, amount)); },
    update(dt: number) {
      // listener
      if (ctx.camera) eng.syncListener(ctx.camera.matrixWorld);
      // room auto-detect (throttled, with hysteresis)
      roomTimer += dt;
      if (roomTimer >= 0.25) {
        roomTimer = 0;
        const pp = playerPos();
        const r = ctx.level && pp ? ctx.level.roomAt(pp) : null;
        if (r) {
          if (r.id !== roomCandidate) { roomCandidate = r.id; roomStable = 0; }
          else if (r.id !== eng.roomId && ++roomStable >= 1) applyRoom(r.id, r.bounds);
        }
        eng.updateLoopOcclusion();
      }
      // muffle
      concussion = Math.max(0, concussion - dt * 0.9);
      eng.setMuffleAmount(Math.max(userMuffle, stateMuffle, concussion));
      // music logic (throttled)
      musicTimerAcc += dt;
      if (musicTimerAcc >= 0.25) {
        const step = musicTimerAcc; musicTimerAcc = 0;
        const active = ctx.enemies ? ctx.enemies.activeCount : 0;
        if (active > 0) { activeFor += step; quietFor = 0; } else { quietFor += step; activeFor = 0; }
        if (!autoCombat && activeFor > 1.2 && (requested === 'ambient' || requested === 'tension') && ctx.state === 'playing') autoCombat = true;
        if (autoCombat && quietFor > 4) { autoCombat = false; aftermathUntil = eng.now + 22; }
        if (aftermathUntil && eng.now > aftermathUntil) aftermathUntil = 0;
        refreshMusic();
        amb.busy = effective === 'combat' ? 1 : active > 0 ? 0.7 : effective === 'tension' ? 0.3 : 0;
        amb.enabled = ctx.state === 'playing';
        if (eng.running) music.tick();
      }
      // low health: heartbeat + tinnitus
      const pl = ctx.player;
      const playing = ctx.state === 'playing' || ctx.state === 'cutscene';
      if (pl && pl.alive && playing && pl.health < 40 && eng.running) {
        const h = Math.max(0, pl.health);
        const k = (40 - h) / 40;
        if (eng.now >= nextBeat) {
          eng.play('heartbeat', { volume: 0.35 + 0.75 * k });
          nextBeat = eng.now + 1.05 - 0.5 * k;
        }
      }
      const ringLv = pl && pl.alive && playing && pl.health < 25 ? (25 - Math.max(0, pl.health)) / 25 : 0;
      if (ringLv > 0 && !tinnitus) tinnitus = eng.loop('tinnitus', { volume: 0 }) as LoopVoice;
      if (tinnitus) {
        tinnitus.setVolume(ringLv, 1.0);
        if (ringLv === 0) { tinnitus.stop(1.5); tinnitus = null; }
      }
      amb.update();
    },
    debug: {
      engine: eng, music, ambience: amb, voice,
      get preRenderMs() { return eng.preRenderMs; },
      get musicMode() { return effective; },
    },
  };

  function applyRoom(id: string, bounds?: THREE.Box3 | null) {
    eng.setRoom(id);
    let b = bounds;
    if (b === undefined) b = ctx.level?.rooms?.find((r) => r.id === id)?.bounds ?? null;
    amb.applyRoom(b);
    bedStarted = true;
  }

  function refreshMusic() {
    let m: MusicMode = requested;
    const st = ctx.state;
    if (st === 'menu' && !(requestedAt > menuSince && requested !== 'silence')) m = 'menu';
    else if (st === 'dead') m = 'silence';
    else if (autoCombat) m = 'combat';
    else if (aftermathUntil && (requested === 'ambient' || requested === 'tension')) m = 'aftermath';
    if (m !== effective) { effective = m; music.set(m); }
  }

  // ───────────── event wiring
  const ev = ctx.events;

  ev.on('weapon:fired', ({ weapon }) => {
    if (weapon === 'pistol') {
      eng.play('pistol_fire');
      const p = besidePlayer(tmpB, 0.6, 0.3);
      if (p) eng.play('casing_metal', { position: p, delay: 0.38 + Math.random() * 0.2, noOcclusion: true });
    } else {
      eng.play('shotgun_fire');
      concussion = Math.max(concussion, 0.12);
      eng.play('shotgun_pump', { delay: 0.36 });
      const p = besidePlayer(tmpB, 0.7, 0.2);
      if (p) eng.play('shell_drop', { position: p, delay: 0.8 + Math.random() * 0.15, noOcclusion: true });
    }
  });
  ev.on('weapon:empty', () => eng.play('dry_fire'));
  ev.on('weapon:switched', () => eng.play('weapon_switch'));
  ev.on('weapon:reload', ({ weapon, duration }) => {
    const d = Math.max(0.3, duration);
    if (weapon === 'pistol') {
      eng.play('pistol_mag_out', { delay: d * 0.12 });
      eng.play('gear_rattle', { delay: d * 0.3, volume: 1.5 });
      eng.play('pistol_mag_in', { delay: d * 0.55 });
      eng.play('pistol_slide', { delay: d * 0.8 });
    } else {
      const w = ctx.player?.weapons.shotgun;
      const missing = w ? Math.max(1, Math.min(w.clipSize - w.clip, w.reserve || 99)) : 4;
      const shells = d < 0.8 ? 1 : missing;
      const span = d < 0.8 ? 0 : d * 0.7;
      for (let i = 0; i < shells; i++) eng.play('shell_insert', { delay: d * 0.12 + (shells > 1 ? (span * i) / (shells - 1) : 0) });
      if (w && w.clip === 0 && d >= 0.8) eng.play('shotgun_pump', { delay: d * 0.92 });
    }
  });

  let impactWindow = 0, impactCount = 0;
  ev.on('bullet:impact', ({ point, surface }) => {
    const t = eng.now;
    if (t - impactWindow > 0.05) { impactWindow = t; impactCount = 0; }
    if (++impactCount > 3) return;
    eng.play(IMPACT_ID[surface] ?? 'impact_metal', { position: point });
    if (surface === 'metal' && Math.random() < 0.22) eng.play('ricochet', { position: point, delay: 0.015 });
  });

  ev.on('player:footstep', ({ surface, running }) => {
    let id = STEP_ID[surface] ?? 'step_metal';
    if (surface === 'metal' && GRATE_ROOMS.has(eng.roomId)) id = 'step_grate';
    eng.play(id, { volume: running ? 1.2 : 0.75, pitch: running ? 1.03 : 1 });
    if (running && Math.random() < 0.6) eng.play('gear_rattle', { volume: 0.8 });
  });
  ev.on('player:jump', () => eng.play('jump'));
  ev.on('player:land', ({ speed }) => eng.play('land', { volume: Math.max(0.3, Math.min(1.4, speed / 7)) }));
  ev.on('player:damaged', ({ amount }) => {
    eng.play('hurt_impact', { volume: Math.min(1.3, 0.5 + amount / 20) });
    if (amount >= 12) {
      eng.play('ear_ring', { volume: Math.min(1, amount / 25) });
      concussion = Math.max(concussion, Math.min(0.55, amount / 35));
    }
  });
  ev.on('player:died', () => eng.play('player_death'));
  ev.on('player:flashlight', ({ on }) => eng.play(on ? 'flashlight_on' : 'flashlight_off'));

  ev.on('pickup', ({ kind }) => {
    const id = kind === 'pistol' || kind === 'shotgun' ? 'pickup_weapon'
      : kind === 'medkit' ? 'pickup_medkit' : kind === 'keycard' ? 'pickup_keycard' : 'pickup_ammo';
    eng.play(id);
  });

  ev.on('door:opening', ({ position }) => eng.play('door_open', { position: lift(position, 1.4) }));
  ev.on('door:closing', ({ position }) => eng.play('door_close', { position: lift(position, 1.4) }));
  ev.on('door:denied', ({ position }) => eng.play('denied', { position: lift(position, 1.3) }));

  ev.on('interact', ({ kind, position }) => {
    const p = position ? lift(position, 0) : undefined;
    if (kind === 'terminal' || kind === 'log') eng.play('terminal_beep', { position: p });
    else if (kind === 'lever') eng.play('lever', { position: p });
    else if (kind === 'button') eng.play('button', { position: p });
  });

  ev.on('enemy:spawned', ({ type, position }) => {
    if (type === 'skitter') eng.play('skitter_chitter', { position: lift(position, ENEMY_Y.skitter), volume: 0.7 });
  });
  ev.on('enemy:woke', ({ type, position }) => {
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'husk') eng.play('husk_wake', { position: p });
    else if (type === 'foreman') { eng.play('husk_wake', { position: p, pitch: 0.7 }); eng.play('foreman_step', { position: lift(position, 0.05, tmpC), delay: 0.3 }); }
    else if (type === 'skitter') eng.play('skitter_chitter', { position: p });
    else eng.play('sentry_wake', { position: p });
  });
  ev.on('enemy:alerted', ({ type, position }) => {
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'skitter') eng.play('skitter_screech', { position: p });
    else if (type === 'husk') eng.play('husk_vocal', { position: p });
    else if (type === 'foreman') {
      // three staff voices, out of sync
      eng.play('husk_vocal', { position: p, pitch: 0.82 });
      eng.play('husk_vocal', { position: p, pitch: 1.0, delay: 0.11 });
      eng.play('husk_vocal', { position: p, pitch: 1.17, delay: 0.24 });
    } else eng.play('sentry_alert', { position: p });
  });
  ev.on('enemy:attack', ({ type, position, kind }) => {
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'foreman') { eng.play(kind === 'melee' ? 'foreman_slam' : 'arm_reach', { position: p }); return; }
    if (type === 'skitter') eng.play('skitter_attack', { position: p });
    else if (type === 'husk') { eng.play('husk_attack', { position: p }); if (Math.random() < 0.35) eng.play('husk_vocal', { position: p, volume: 0.8 }); }
    else eng.play('sentry_fire', { position: p });
  });
  ev.on('enemy:damaged', ({ type, point }) => {
    eng.play('impact_robot', { position: point });
    const r = Math.random();
    if (type === 'skitter' && r < 0.6) eng.play('skitter_hurt', { position: point });
    else if (type === 'husk' && r < 0.4) eng.play('husk_hurt', { position: point });
    else if (type === 'sentry' && r < 0.6) eng.play('sentry_hurt', { position: point });
    else if (type === 'foreman' && r < 0.4) eng.play('husk_hurt', { position: point, pitch: 0.8 });
  });
  ev.on('enemy:died', ({ type, position }) => {
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'foreman') {
      for (let i = 0; i < 3; i++) eng.play('husk_death', { position: p, delay: i * 0.35, pitch: 0.8 + i * 0.15, variant: i % 2 });
      eng.play('foreman_slam', { position: lift(position, 0.3, tmpC), delay: 1.1 });
      return;
    }
    eng.play(`${type}_death`, { position: p });
  });
  ev.on('enemy:step', ({ type, position }) => {
    if (type === 'sentry') return;
    const p = lift(position, 0.05);
    if (type === 'skitter') eng.play('skitter_step', { position: p });
    else if (type === 'foreman') eng.play('foreman_step', { position: p });
    else { eng.play('husk_step', { position: p }); if (Math.random() < 0.2) eng.play('husk_joint', { position: lift(position, 1.2, tmpC) }); }
  });

  ev.on('story:beat', ({ id }) => {
    const pp = playerPos();
    switch (id) {
      case 'wake':
        eng.play('heartbeat', { volume: 0.6 }); eng.play('heartbeat', { volume: 0.45, delay: 0.95 });
        break;
      case 'corr_blackout': {
        eng.play('power_down', { volume: 0.8 });
        if (pp) {
          // something scuttles through the ceiling duct, from behind to ahead of the player
          tmpB.set(pp.x + 0.4, 3.05, pp.z + 4.5);
          tmpC.set(pp.x - 0.3, 3.05, pp.z - 11);
          eng.play('vent_scuttle', { position: tmpB, moveTo: tmpC, moveDur: 2.7, delay: 1.4, noOcclusion: true, volume: 1.1 });
        }
        break;
      }
      case 'sec_ambush': {
        const vent = ctx.level?.object('sec_vent');
        if (vent) { vent.getWorldPosition(tmpB); eng.play('metal_clang', { position: tmpB, noOcclusion: true }); }
        break;
      }
      case 'storage_unlocked':
        eng.play('door_unlock', { position: tmpB.set(3, 1.3, -17) });
        break;
      case 'power_restored':
        eng.play('power_up', { volume: 0.9 });
        amb.powerOn = true; amb.applyRoom();
        break;
      case 'choir_speaks':
        eng.play('glitch', { volume: 0.8 });
        break;
      case 'fab_ambush':
        eng.play('sting');
        for (let i = 0; i < 3; i++) eng.play('alarm_blip', { delay: 0.6 + i * 0.55, volume: 0.8 });
        break;
      case 'elevator_ready':
        eng.play('elevator_arrive', { position: tmpB.set(0, 1.5, -60.5) });
        break;
      case 'descent':
        eng.play('elevator_start');
        break;
    }
  });

  ev.on('game:state', ({ state, prev }) => {
    stateMuffle = state === 'paused' ? 0.85 : state === 'dead' ? 0.6 : 0;
    if (state === 'menu') menuSince = eng.now;
    if (state === 'dead') eng.play('sting', { variant: 2, volume: 0.9 });
    if (state === 'playing' && !bedStarted) {
      const pp = playerPos();
      const r = ctx.level && pp ? ctx.level.roomAt(pp) : null;
      applyRoom(r ? r.id : 'med', r ? r.bounds : undefined);
    }
    if (state === 'ended') stateMuffle = 0.3;
    void prev;
    refreshMusic();
  });

  voice.choirFallback = (text, duration) => sys.choirVoice(text, duration);
  return sys;
}
