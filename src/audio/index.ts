/**
 * COLD BOOT audio. Everything is synthesised: one-shots are pre-rendered offline at load
 * (see sounds/*), loops/music/voice are generative. Subscribes to game events itself — see SOUNDS.md.
 */
import * as THREE from 'three';
import type { AudioLogEntry, AudioSystem, EnemyType, GameContext, LoopHandle, MusicState, PlayOpts, Surface, VoiceHandle } from '../core/types';
import { AudioEngine, type LoopVoice } from './engine';
import { setSynthRate } from './synth/core';
import { enableSoundCache } from './synth/cache';
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
  /** Level 3 mood switch (warm bed ↔ cold bed): what `play('habitat_takeover')` / `story:beat habitat_takeover` do. */
  setMood(cold: boolean): void;
  readonly cold: boolean;
  /** Stage 3c §10.0 H14: the last 512 `play` / `loop` / `say` calls `{ id, t, pos }` (engine.log) — the one-owner audit. */
  readonly log: AudioLogEntry[];
}

const STEP_ID: Record<Surface, string> = {
  metal: 'step_metal', concrete: 'step_concrete', rubber: 'step_rubber', glass: 'step_glass', robot: 'step_metal', flesh: 'step_rubber',
  water: 'wade_shallow', // stage 3d §8.3: by player.wading — `wade_shallow` (< 0.35 m) / `wade` (see player:footstep)
};
const IMPACT_ID: Record<Surface, string> = {
  metal: 'impact_metal', concrete: 'impact_concrete', rubber: 'impact_rubber', glass: 'impact_glass', robot: 'impact_robot', flesh: 'impact_flesh',
  water: 'impact_water', // stage 3d §8.3 / §8.12
};
// (the loader plays every sound of its own — enemies-owned, §8.12; its entry is only for completeness)
const ENEMY_Y: Record<EnemyType, number> = { skitter: 0.35, husk: 1.4, sentry: 0, foreman: 1.9, soldier: 1.55, loader: 6 };
const GRATE_ROOMS = new Set(['corr_a', 'elevator']);
/** Level 3 (habitat): the floor under the player's feet by room id — the contract's `Surface` has no carpet/tile, so
 *  footsteps there are chosen by room (any surface but glass / flesh / robot). `step_wood` is available for story use. */
const FLOOR_L3: Record<string, string> = {
  gallery_n: 'step_carpet', lobby: 'step_carpet', admin: 'step_carpet', office: 'step_carpet', stair_w: 'step_carpet', quarters: 'step_carpet',
  canteen: 'step_tile', atrium: 'step_tile', clinic: 'step_tile', bio_lock: 'step_tile',
};

/** Level 4 (stage 3b): the clean side's epoxy/vinyl floors and the tube's grated deck, by room id (navy rooms keep the
 *  surface's own step). Same rule as level 3: any surface but glass / flesh / robot. */
const FLOOR_L4: Record<string, string> = {
  gown: 'step_tile', shower: 'step_tile', corr_n: 'step_tile', corr_w: 'step_tile', corr_e: 'step_tile', corr_s: 'step_tile',
  wetlab: 'step_tile', pi_office: 'step_tile', cold: 'step_tile', records: 'step_tile', vivarium: 'step_tile', scrub: 'step_tile',
  store4: 'step_tile', gallery: 'step_tile', bay: 'step_tile', tube: 'step_grate', gatel: 'step_grate',
};
/** Level 5 (stage 3c): floors by room id (navy decks keep the surface's own step; grating and puddles by position). */
const FLOOR_L5: Record<string, string> = {
  lock5: 'step_grate', ready5: 'step_rubber', berths5: 'step_rubber', heads5: 'step_tile', mess5: 'step_tile', galley5: 'step_tile',
};
/** Level 5: doors that play their own sound (S1o: `d5_gate` owns gate_open_heavy / gate_close_heavy) — no door_open / close. */
const OWN_SOUND_DOORS = new Set(['d5_gate']);
/** Passing rounds (§8.2.5) are played at the ray's closest point to the head: never occlusion-tested. */
const NO_OCC_IDS = new Set(['bullet_whiz', 'bullet_crack']);
/** A soldier burst's room tail plays this long after its last round (pistol 2 × 0.35 s, carbine 3 × 0.11 s). */
const SOLDIER_BURST_GAP = 0.42;
/** carbine_tail variant by the room's reverb: 0 small, 1 medium, 2 large. */
const TAIL_SIZE: Record<string, number> = {
  dead: 0, padded: 0, office: 0, lock: 0, whiteroom: 1, tiled: 1, corridor: 1, machine: 1,
  hall: 2, shaft: 2, cistern: 2, atrium: 2, clean: 2, tube: 2, tunnel: 2, chamber: 2,
};
/** Seconds without a carbine round after which the burst's room tail plays (the carbine fires every 0.1 s). */
const BURST_GAP = 0.11;
/** Level-4 sounds rendered on demand elsewhere (level-3 ids reused here): warm them up after the idle set. */
const WARM_L4 = ['amb_hab_cold', 'amb_lock', 'step_tile', 'hull_creak', 'pipe_tick', 'far_steps'];
/** Level 5: ids of other levels it uses (beds' events, footsteps, the drains / vents, the beacon). */
const WARM_L5 = ['step_tile', 'hull_creak', 'pipe_tick', 'metal_groan', 'tube_groan', 'sump_lift', 'vent_grille', 'alarm_beacon', 'locker_bang'];
/** Level 6 (stage 3d): ids of other levels it uses — the taken soldiers (3c, `levels: [5]`: first, so the first shot is
 *  never late), the beds' events, the 3c vignette sounds the plan reuses (§8.12). */
const WARM_L6 = ['soldier_carbine_fire', 'soldier_pistol_fire', 'soldier_fire_tail', 'bullet_whiz', 'bullet_crack', 'soldier_step', 'soldier_hit_vest',
  'soldier_aim_click', 'soldier_light_on', 'soldier_reload', 'soldier_fall', 'clasp_fail', 'step_wet',
  'hull_creak', 'tube_groan', 'water_slosh', 'lamp_creak', 'bulb_pop', 'glass_tinkle', 'lights_out_dock', 'alarm_beacon', 'sump_lift', 'vent_grille'];
/** Level 6: rooms whose floor is grating (the shaft's stairs and landings, the chamber's galleries / mid deck / cage). */
const GRATE_L6 = new Set(['shaft6']);

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
  const level = levelOf(ctx);
  eng.level = level.id;
  eng.paDock = !!level.paDock;
  eng.lowMemory = !!ctx.debug?.mobile;
  if (ctx.debug?.mobile) setSynthRate(24000); // phones: half the sound bank memory (bandwidth to 12 kHz)
  // phones: reloads read the sounds back instead of synthesising them (`?nocache`: always synthesise)
  if (ctx.debug?.mobile && !/[?&]nocache\b/.test(location.search)) enableSoundCache();
  await eng.loadIrs();
  await eng.preload();
  if (ctx.debug?.verbose) console.info(`[audio] pre-rendered load set in ${eng.preRenderMs.toFixed(0)} ms`);
  // Phones: background work waits until the level has finished loading — it would overlap the boot's memory peak
  // (lighting bake / shader compile) and steal its main thread. Desktop: as soon as loading has moved on.
  const later = (fn: () => void, ms: number) => {
    if (!ctx.debug?.mobile) { setTimeout(fn, ms); return; }
    const wait = () => { if (ctx.ready) setTimeout(fn, 1500 + ms); else setTimeout(wait, 250); };
    wait();
  };
  // the rest renders in the background once loading has moved on
  later(() => { eng.renderIdle(); }, 200);

  const music = new Music(eng.ctx, eng.buses.music, eng.plateIn, (id) => eng.buffers(id));
  const amb = new Ambience(eng);
  const voice = new VoiceBank(eng);
  // levels after the first start powered (level 2: the hall is held, not dead) — LEVELS[id].powerOnAtLoad
  if (level.powerOnAtLoad) amb.powerOn = true;
  if (level.id === 4) later(() => { for (const id of WARM_L4) void eng.ensure(id); }, 2500);
  if (level.id === 5) later(() => { for (const id of WARM_L5) void eng.ensure(id); }, 2500);
  if (level.id === 6) later(() => { for (const id of WARM_L6) void eng.ensure(id); }, 1200);
  // this level's voice files: fetch the bytes in the background (decode stays lazy)
  later(() => { try { voice.prefetchLevel(level.id); } catch { /* ignore */ } }, 1500);
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
  /** Carbine burst in progress: AudioContext time of its last round (0 = none). */
  let carbineLast = 0;
  /** Level 5: soldier bursts in progress (one per shooter position) awaiting their room tail. */
  const soldierBursts: Array<{ pos: THREE.Vector3; last: number; rounds: number }> = [];

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

  let unlockedOnce = false;
  // ───────────── public API
  const sys: AudioSystem & { debug: AudioDebug } = {
    async unlock() {
      try {
        // iOS: play as media — through the silent switch, not as a ringer-class sound (Safari 16.4+)
        const as = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (as && as.type !== 'playback') as.type = 'playback';
        // after a phone call / Siri Safari leaves the context 'interrupted'; a resume inside a gesture brings it back
        if (eng.ctx.state === 'running' && unlockedOnce) return;
        unlockedOnce = true;
        if (eng.ctx.state !== 'running') await eng.ctx.resume();
        // iOS/Safari: a silent buffer from inside the gesture
        const b = eng.ctx.createBuffer(1, 1, eng.ctx.sampleRate);
        const s = eng.ctx.createBufferSource(); s.buffer = b; s.connect(eng.ctx.destination); s.start();
      } catch (e) {
        console.warn('[audio] unlock failed', e);
      }
    },
    play(id: string, opts?: PlayOpts) {
      if (id === 'habitat_takeover') setMood(true); // the story's one switch: warm bed → cold bed (also via story:beat)
      const pos = opts?.position;
      if (pos && id === 'soldier_step') { eng.play(id, { position: pos, volume: opts?.volume, pitch: opts?.pitch, variant: soldierStepVariant(pos) }); return; }
      eng.play(id, opts ? { position: pos, volume: opts.volume, pitch: opts.pitch, noOcclusion: NO_OCC_IDS.has(id) || undefined } : undefined);
      if (pos && (id === 'soldier_carbine_fire' || id === 'soldier_pistol_fire')) soldierShot(pos);
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
        if (r && pp) {
          const id = subRoom(r.id, pp);
          if (id !== roomCandidate) { roomCandidate = id; roomStable = 0; }
          else if (id !== eng.roomId && ++roomStable >= 1) applyRoom(id, r.bounds);
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
      // the carbine burst ended: its room tail
      if (carbineLast && eng.now - carbineLast > BURST_GAP) {
        carbineLast = 0;
        eng.play('carbine_tail', { variant: TAIL_SIZE[eng.room.ir] ?? 1 });
      }
      // a soldier's burst ended: its room tail at the shooter, louder relative to the shot the farther he is
      for (let i = soldierBursts.length - 1; i >= 0; i--) {
        const b = soldierBursts[i];
        if (eng.now - b.last <= SOLDIER_BURST_GAP) continue;
        soldierBursts.splice(i, 1);
        const d = b.pos.distanceTo(eng.listener);
        eng.play('soldier_fire_tail', { position: b.pos, variant: TAIL_SIZE[eng.room.ir] ?? 1, volume: Math.min(1.3, 0.6 + d / 40) * (b.rounds > 1 ? 1 : 0.8), noOcclusion: true });
      }
      amb.update();
    },
    debug: {
      engine: eng, music, ambience: amb, voice,
      get preRenderMs() { return eng.preRenderMs; },
      get musicMode() { return effective; },
      setMood,
      get cold() { return eng.cold; },
      log: eng.log,
    },
  };

  /** Level 5 (stage 3c §2.1, §2.9): what a foot at `p` stands on — 'wet' (a puddle patch in `regions.wet`), 'grate' (the
   *  spine's grating over the crawlway, the sub bay's galleries, the gate lock) or 'deck'. */
  function surfaceL5(p: THREE.Vector3): 'wet' | 'grate' | 'deck' {
    const lv = ctx.level;
    if (!lv) return 'deck';
    const wet = lv.regions?.wet;
    if (wet) for (const b of wet) if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y >= b.min.y - 0.5 && p.y <= b.max.y + 0.5) return 'wet';
    const r = lv.roomAt(p);
    if (!r) return 'deck';
    if (r.id === 'lock5') return 'grate';
    if (r.id === 'sub5' && p.y > 4) return 'grate';
    if (r.id === 'spine5' && p.y > -0.5 && r.floors) {
      // above one of the spine's lower (crawl) floors = on the grating
      for (const f of r.floors) if (f.y < -0.5 && p.x >= f.box[0] && p.x <= f.box[1] && p.z >= f.box[2] && p.z <= f.box[3]) return 'grate';
    }
    return 'deck';
  }
  function soldierStepVariant(p: THREE.Vector3): number {
    const k = level.id === 5 ? surfaceL5(p) : 'deck';
    return (k === 'grate' ? 3 : k === 'wet' ? 6 : 0) + Math.floor(Math.random() * 3);
  }
  /** A soldier round (W3b plays soldier_*_fire at the muzzle): group it into its shooter's burst for the room tail. */
  function soldierShot(p: THREE.Vector3): void {
    for (const b of soldierBursts) if (b.pos.distanceToSquared(p) < 4) { b.pos.copy(p); b.last = eng.now; b.rounds++; return; }
    if (soldierBursts.length < 8) soldierBursts.push({ pos: p.clone(), last: eng.now, rounds: 1 });
  }
  /** Level 5: the crawlway (spine5 / arm5 below the main floor) and the magazine (arm5, deeper) are their own rooms. */
  function subRoom(id: string, p: THREE.Vector3): string {
    if (level.id === 6) {
      // the cable trench under the vault / head-end floors; the undercroft under the chamber's mid deck (§2.1 regions)
      if ((id === 'vault6' || id === 'he6') && p.y < -0.7) return 'trench6';
      if (id === 'pool6' && p.y < -16.3 && p.x >= -72.8 && p.x <= -31.2 && p.z >= -166 && p.z <= -148.2) return 'under6';
      return id;
    }
    if (level.id !== 5) return id;
    if (id === 'spine5' && p.y < -0.5) return 'crawl5';
    if (id === 'arm5' && p.y < -0.5) return p.y < -2.0 ? 'mag5' : 'crawl5';
    return id;
  }

  function applyRoom(id: string, bounds?: THREE.Box3 | null) {
    eng.setRoom(id);
    let b = bounds;
    if (b === undefined) b = ctx.level?.rooms?.find((r) => r.id === id)?.bounds ?? null;
    amb.applyRoom(b);
    bedStarted = true;
  }

  /** Level 6: depth of water at a foot position (0 when dry / no water volumes). */
  function waterDepth(p: THREE.Vector3): number {
    const w = level.id === 6 ? ctx.level?.water : undefined;
    if (!w) return 0;
    for (const v of w) {
      const b = v.box;
      if (p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y < v.surface && p.y >= b.min.y - 0.3) return v.surface - p.y;
    }
    return 0;
  }

  /** Level 6: the quiet after the cut (rooms with an `after` form switch; the bed crossfades over ~2 s). */
  function setAfter(on: boolean) {
    if (!eng.setMood(eng.cold, on)) return;
    if (bedStarted) amb.applyRoom(undefined, 2.0);
  }

  /** Level 3: warm bed ↔ cold bed (rooms re-resolve to their `cold` preset; the bed crossfades over ~1.2 s). */
  function setMood(cold: boolean) {
    if (!eng.setMood(cold)) return;
    if (bedStarted) amb.applyRoom(undefined, 1.2);
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
    } else if (weapon === 'carbine') {
      eng.play('carbine_fire');
      carbineLast = eng.now;
      const p = besidePlayer(tmpB, 0.7, 0.4);
      if (p) eng.play('casing_metal', { position: p, delay: 0.32 + Math.random() * 0.2, noOcclusion: true, volume: 0.85 });
    } else {
      eng.play('shotgun_fire');
      concussion = Math.max(concussion, 0.12);
      eng.play('shotgun_pump', { delay: 0.36 });
      const p = besidePlayer(tmpB, 0.7, 0.2);
      if (p) eng.play('shell_drop', { position: p, delay: 0.8 + Math.random() * 0.15, noOcclusion: true });
    }
  });
  ev.on('weapon:empty', ({ weapon }) => eng.play(weapon === 'carbine' ? 'carbine_empty' : 'dry_fire'));
  ev.on('weapon:switched', ({ weapon }) => eng.play(weapon === 'carbine' ? 'carbine_raise' : 'weapon_switch'));
  ev.on('weapon:reload', ({ weapon, duration }) => {
    const d = Math.max(0.3, duration);
    if (weapon === 'pistol') {
      eng.play('pistol_mag_out', { delay: d * 0.12 });
      eng.play('gear_rattle', { delay: d * 0.3, volume: 1.5 });
      eng.play('pistol_mag_in', { delay: d * 0.55 });
      eng.play('pistol_slide', { delay: d * 0.8 });
    } else if (weapon === 'carbine') {
      // 2.2 s, or 2.6 s from empty (+ the charging handle)
      const empty = ctx.player?.weapons.carbine?.clip === 0 || d >= 2.45;
      eng.play('carbine_mag_out', { delay: d * 0.1 });
      eng.play('gear_rattle', { delay: d * 0.3, volume: 1.4 });
      eng.play('carbine_mag_in', { delay: d * (empty ? 0.5 : 0.6) });
      if (empty) eng.play('carbine_bolt', { delay: d * 0.78 });
      else eng.play('gear_rattle', { delay: d * 0.85, volume: 0.9 });
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
    // level 3: the habitat's glazing is thick laminate and holds — it does not shatter
    // level 4: the only flesh in the world geometry is the dead (bodies; the enemies are machines)
    const id = surface === 'glass' && level.id === 3 ? 'impact_glass_hold' : surface === 'flesh' && level.id === 4 ? 'body_hit' : IMPACT_ID[surface] ?? 'impact_metal';
    eng.play(id, { position: point });
    if (surface === 'metal' && Math.random() < 0.22) eng.play('ricochet', { position: point, delay: 0.015 });
  });

  ev.on('player:footstep', ({ position, surface, running }) => {
    if (surface === 'water') {
      // stage 3d §8.3: wading — by the depth at his feet (player.wading)
      const d = ctx.player?.wading ?? 0;
      eng.play(d >= 0.35 ? 'wade' : 'wade_shallow', { volume: running ? 1.15 : 0.85, pitch: running ? 1.03 : 1 });
      return;
    }
    let id = STEP_ID[surface] ?? 'step_metal';
    if (surface === 'metal' && GRATE_ROOMS.has(eng.roomId)) id = 'step_grate';
    if (level.id === 3 && surface !== 'glass' && surface !== 'flesh' && surface !== 'robot') id = FLOOR_L3[eng.roomId] ?? id;
    if (level.id === 4 && surface !== 'glass' && surface !== 'flesh' && surface !== 'robot') id = FLOOR_L4[eng.roomId] ?? id;
    if (level.id === 5 && surface !== 'glass' && surface !== 'flesh' && surface !== 'robot') {
      const k = position ? surfaceL5(position) : 'deck';
      id = k === 'wet' ? 'step_wet' : k === 'grate' ? 'step_grate' : FLOOR_L5[eng.roomId] ?? id;
    }
    if (level.id === 6 && surface === 'metal' && (GRATE_L6.has(eng.roomId) || (eng.roomId === 'pool6' && (position?.y ?? -20) > -13.5))) id = 'step_grate';
    eng.play(id, { volume: running ? 1.2 : 0.75, pitch: running ? 1.03 : 1 });
    if (running && Math.random() < 0.6) eng.play('gear_rattle', { volume: 0.8 });
  });
  ev.on('player:jump', () => eng.play('jump'));
  ev.on('player:land', ({ speed }) => eng.play('land', { volume: Math.max(0.3, Math.min(1.4, speed / 7)) }));
  ev.on('player:damaged', ({ amount, absorbed, armor }) => {
    // armour (§8.2): to 0 from > 0 → the plate breaks; a hit the plate took most of (≥ 60 %) → a hard knock, body softer
    const abs = absorbed ?? 0;
    if (abs > 0 && (armor ?? 0) <= 0) eng.play('armor_break');
    else if (abs > 0 && abs >= 0.6 * (amount + abs)) eng.play('armor_hit', { volume: Math.min(1.2, 0.6 + (amount + abs) / 30) });
    eng.play('hurt_impact', { volume: Math.min(1.3, 0.5 + amount / 20) * (abs > 0 ? 0.7 : 1) });
    if (amount >= 12) {
      eng.play('ear_ring', { volume: Math.min(1, amount / 25) });
      concussion = Math.max(concussion, Math.min(0.55, amount / 35));
    }
  });
  ev.on('player:died', () => eng.play('player_death'));
  // stage 3d D12 / §8.3: the deep-water fail-safe placed him back on the deck (audio owns the sound; W1 plays none)
  ev.on('player:rescued', () => eng.play('drown_rescue'));
  // stage 3c coordinator 5a (every level): the cell ran flat → its own death; a switch press on a flat cell → a dry click
  ev.on('player:flashlight', ({ on, cause }) => eng.play(cause === 'empty' ? 'flashlight_die' : cause === 'refused' ? 'flashlight_dead' : on ? 'flashlight_on' : 'flashlight_off'));

  // armour gained (vest strap done, plate touched): by its size — a vest is +50, a plate +15. Not on restore / carry.
  ev.on('player:armor', ({ delta }) => {
    if (delta > 0) eng.play(delta >= 30 ? 'vest_on' : 'plate_in');
  });
  ev.on('pickup', ({ kind }) => {
    if (kind === 'vest' || kind === 'plate') return; // player:armor plays them (only when armour actually changed)
    const id = kind === 'pistol' || kind === 'shotgun' || kind === 'carbine' ? 'pickup_weapon'
      : kind === 'medkit' ? 'pickup_medkit' : kind === 'keycard' ? 'pickup_keycard' : 'pickup_ammo';
    eng.play(id);
  });

  ev.on('door:opening', ({ id, position }) => { if (!OWN_SOUND_DOORS.has(id)) eng.play('door_open', { position: lift(position, 1.4) }); });
  ev.on('door:closing', ({ id, position }) => { if (!OWN_SOUND_DOORS.has(id)) eng.play('door_close', { position: lift(position, 1.4) }); });
  ev.on('door:denied', ({ position }) => eng.play('denied', { position: lift(position, 1.3) }));

  ev.on('interact', ({ kind, position }) => {
    const p = position ? lift(position, 0) : undefined;
    if (kind === 'terminal' || kind === 'log') eng.play('terminal_beep', { position: p });
    else if (kind === 'lever') eng.play('lever', { position: p });
    else if (kind === 'button') eng.play('button', { position: p });
  });

  ev.on('enemy:spawned', ({ type, position }) => {
    if (type === 'loader') return;
    if (type === 'skitter') eng.play('skitter_chitter', { position: lift(position, ENEMY_Y.skitter), volume: 0.7 });
  });
  // soldiers (stage 3c §8.11): the enemies module plays every soldier sound itself; audio plays only soldier_step on
  // enemy:step (the surface by position) and the burst's room tail — so none of the husk / sentry / robot sounds below
  // stage 3d §8.12: the dock loader likewise plays every sound of its own (loader_*, flood_pop, ram_*, cowl_open,
  // armour_clank, loader_death) — audio adds nothing for type `loader`
  ev.on('enemy:woke', ({ type, position }) => {
    if (type === 'soldier' || type === 'loader') return;
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'husk') eng.play('husk_wake', { position: p });
    else if (type === 'foreman') { eng.play('husk_wake', { position: p, pitch: 0.7 }); eng.play('foreman_step', { position: lift(position, 0.05, tmpC), delay: 0.3 }); }
    else if (type === 'skitter') eng.play('skitter_chitter', { position: p });
    else eng.play('sentry_wake', { position: p });
  });
  ev.on('enemy:alerted', ({ type, position }) => {
    if (type === 'soldier' || type === 'loader') return;
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
    if (type === 'soldier' || type === 'loader') return;
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'foreman') { eng.play(kind === 'melee' ? 'foreman_slam' : 'arm_reach', { position: p }); return; }
    if (type === 'skitter') eng.play('skitter_attack', { position: p });
    else if (type === 'husk') { eng.play('husk_attack', { position: p }); if (Math.random() < 0.35) eng.play('husk_vocal', { position: p, volume: 0.8 }); }
    else eng.play('sentry_fire', { position: p });
  });
  ev.on('enemy:damaged', ({ type, point }) => {
    if (type === 'soldier' || type === 'loader') return;
    eng.play('impact_robot', { position: point });
    const r = Math.random();
    if (type === 'skitter' && r < 0.6) eng.play('skitter_hurt', { position: point });
    else if (type === 'husk' && r < 0.4) eng.play('husk_hurt', { position: point });
    else if (type === 'sentry' && r < 0.6) eng.play('sentry_hurt', { position: point });
    else if (type === 'foreman' && r < 0.4) eng.play('husk_hurt', { position: point, pitch: 0.8 });
  });
  ev.on('enemy:died', ({ type, position }) => {
    if (type === 'loader') { music.setBoss(0); return; }
    if (type === 'soldier') return;
    const p = lift(position, ENEMY_Y[type]);
    if (type === 'foreman') {
      for (let i = 0; i < 3; i++) eng.play('husk_death', { position: p, delay: i * 0.35, pitch: 0.8 + i * 0.15, variant: i % 2 });
      eng.play('foreman_slam', { position: lift(position, 0.3, tmpC), delay: 1.1 });
      return;
    }
    eng.play(`${type}_death`, { position: p });
  });
  ev.on('enemy:step', ({ type, position }) => {
    if (type === 'sentry' || type === 'loader') return;
    const p = lift(position, 0.05);
    // stage 3d §8.4: a step in water (level.water) is a wading step, by depth (variants 0–2 shallow, 3–5 deep)
    const wd = waterDepth(position);
    if (wd >= 0.1) { eng.play('wade_enemy', { position: p, variant: (wd >= 0.35 ? 3 : 0) + Math.floor(Math.random() * 3), volume: type === 'skitter' ? 0.5 : 1 }); return; }
    if (type === 'soldier') { eng.play('soldier_step', { position: p, variant: soldierStepVariant(position) }); return; }
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
      case 'habitat_takeover': setMood(true); break; // level 3: the plant AI takes the habitat (also: play('habitat_takeover'))
      case 'habitat_restore': setMood(false); break;
      // level 4: the clean side's lights-out (§4.3) — beds go to the sealed hum; emit it again when restoring past it
      case 'l4_lights_out': if (level.id === 4) setMood(true); break;
      // level 5 (§4.7 L): lights_out5 — spine5 / sub5 go to amb_dark (the level plays lights_out_dock itself); emitted
      // again when a checkpoint restores past it (§7 cp5_door)
      case 'l5_dark': if (level.id === 5) setMood(true); break;
      // level 6 (§4.8): the quiet after the cut and the loader — music to silence, the chamber's beds to their `after`
      // form (amb_pool_quiet). Emit it again when restoring cp6_quiet.
      case 'l6_quiet':
        if (level.id === 6) {
          music.setBoss(0);
          requested = 'silence'; requestedAt = eng.now; autoCombat = false; aftermathUntil = 0; refreshMusic();
          setAfter(true);
        }
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

  // stage 3d §8.12: the boss layer over combat (stage 1 … 3, rising); stage ≥ 2 = lights_out6 on level 6 → the chamber's
  // dark beds (the level plays lights_out_dock itself). A restore re-emits boss:stage (BossControl.restore).
  ev.on('boss:stage', ({ stage }) => {
    music.setBoss(stage);
    if (level.id === 6 && stage >= 2) setMood(true);
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
