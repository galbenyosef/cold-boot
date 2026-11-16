/**
 * Isolated UI harness: dev/ui.html?screen=<name>. A fake GameContext over a painted "photo-like" dark
 * industrial backdrop so every UI screen can be iterated without the 3D game.
 * Screens: menu hud choir log console pause card-intro card-title death ending gate wake
 */
import * as THREE from 'three';
import type { GameContext, GameState, LevelId, WeaponState } from '../../core/types';
import { createEvents } from '../../core/events';
import { LEVEL_KEY, levelOf, parseLevel } from '../../core/progress';
import { END_CARD_L3 } from '../../story/l3/text';
import { createInput } from '../../core/input';
import { createUI } from '../index';
import type { UIInternal } from '../types';
import { LOGS, SEC_CONSOLE, CHOIR, INTRO_CARDS, TITLE_CARD, FRAGMENTS } from '../../story/text';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'hud';

function paintBackdrop(canvas: HTMLCanvasElement) {
  const w = canvas.width = innerWidth, hh = canvas.height = innerHeight;
  const g = canvas.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, hh);
  bg.addColorStop(0, '#05080a'); bg.addColorStop(0.55, '#0b1216'); bg.addColorStop(1, '#030405');
  g.fillStyle = bg; g.fillRect(0, 0, w, hh);
  // corridor perspective: floor + walls
  g.strokeStyle = 'rgba(90,120,130,.12)'; g.lineWidth = 1;
  const cx = w * 0.55, cy = hh * 0.46;
  for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + i * w * 0.12, hh); g.stroke(); }
  for (let k = 1; k < 14; k++) { const y = cy + (hh - cy) * Math.pow(k / 14, 2.2); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // light pools
  const pool = (x: number, y: number, r: number, c: string) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, 'transparent');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  pool(cx, cy - 40, 260, 'rgba(255,170,80,.22)');
  pool(w * 0.2, hh * 0.3, 380, 'rgba(70,140,160,.14)');
  pool(w * 0.85, hh * 0.75, 300, 'rgba(255,40,30,.10)');
  pool(cx + 30, cy - 60, 22, 'rgba(255,230,190,.9)');
  // pipes
  g.fillStyle = 'rgba(20,28,32,.9)';
  for (let i = 0; i < 6; i++) g.fillRect(w * 0.06 + i * 26, 0, 14, hh);
  g.fillStyle = 'rgba(160,190,200,.05)';
  for (let i = 0; i < 6; i++) g.fillRect(w * 0.06 + i * 26 + 3, 0, 2, hh);
  // grain
  const img = g.getImageData(0, 0, w, hh);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
}

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  paintBackdrop(canvas);
  const events = createEvents();
  const weapon = (id: 'pistol' | 'shotgun', clip: number, size: number, reserve: number): WeaponState => ({ id, owned: true, clip, clipSize: size, reserve, reloading: false });
  const player = {
    position: new THREE.Vector3(0, 0, -16), eye: new THREE.Vector3(0, 1.65, -16), forward: new THREE.Vector3(0, 0, -1), velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0, health: 100, maxHealth: 100, alive: true, controlsEnabled: true, flashlightOn: false,
    weapons: { pistol: weapon('pistol', 9, 12, 36), shotgun: weapon('shotgun', 4, 6, 18) }, currentWeapon: null as any,
    focus: null as any, hitMarker: 0, keys: new Set<string>(),
    damage() {}, heal() {}, give() {}, hasKey: () => false, addKey() {}, teleport() {}, shake() {}, lookAt() {}, update() {},
  } as any;
  const stats = { time: 734, kills: 17, logs: 4, logsTotal: 5 };
  const ctx = {
    canvas, uiRoot: document.getElementById('ui')!, events, input: createInput(canvas),
    debug: { autostart: !screen.startsWith('pause'), spawn: null, noEnemies: true, noStory: true, god: true, giveAll: false, quality: null, verbose: false, fps: 60 },
    time: 0, state: 'loading' as GameState, ready: false,
    setState(s: GameState) { if (s === ctx.state) return; const prev = ctx.state; ctx.state = s; events.emit('game:state', { state: s, prev }); },
    player,
    audio: { async unlock() {}, play() {}, loop() { return { setVolume() {}, setPosition() {}, stop() {} }; }, setMusic() {}, setRoom() {}, choirVoice() {}, setMasterVolume() {}, setMuffle() {}, update() {} },
    render: { quality: 'high', setQuality(qq: string) { (this as any).quality = qq; }, post: { fade() {}, glitch() {}, damage() {}, setLowHealth() {}, setExposure() {} } },
    level: { roomAt: () => ({ id: 'junction', name: 'JUNCTION 3' }), object: () => undefined, screen: () => undefined },
    story: { objective: 'Fab access is on security hold — go to Security 3', logs: new Set(['log_med']), stats, lateUpdate() {}, update() {}, async run() {} },
    interactables: { get: () => undefined },
    // ?level=N, else the screen's `-lN` suffix; dialogue / boss screens are level 2's
    levelId: parseLevel(q.get('level')) ?? parseLevel(/-l(\d)$/.exec(screen)?.[1]) ?? (/^dialogue|^boss/.test(screen) ? 2 : 1),
    facts: {},
    enemies: { all: [] as any[], activeCount: 0 },
  } as unknown as GameContext;
  // §8.1: per-level dressing of the fake world (a lookup; level 1 = the defaults above)
  const FAKE: Partial<Record<LevelId, { room: { id: string; name: string }; objective: string }>> = {
    2: { room: { id: 'line', name: 'LINE TWO' }, objective: 'Find a way into Line Control' },
    3: { room: { id: 'l3_stub', name: 'HABITAT LOBBY' }, objective: 'Find someone — the habitat lobby' },
  };
  const fake = FAKE[levelOf(ctx).id];
  if (fake) {
    (ctx.level as any).roomAt = () => fake.room;
    (ctx.story as any).objective = fake.objective;
  }
  (window as any).__game = ctx;
  const ui = await createUI(ctx) as UIInternal;
  ctx.ui = ui;
  (window as any).__ui = ui;

  let last = performance.now();
  const loop = (t: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    ui.update(dt);
    ctx.input.endFrame();
  };
  requestAnimationFrame(loop);

  const dev = document.getElementById('dev')!;
  for (const s of ['menu', 'hud', 'hud-low', 'hud-quiet', 'choir', 'pa', 'note', 'note-terminal', 'note-tag', 'note-voice', 'log', 'console', 'pause', 'card-intro', 'card-title', 'death', 'ending', 'gate', 'wake', 'menu-l2', 'dialogue', 'dialogue-note', 'boss', 'card-title-l2', 'card-end-l2', 'pause-l2', 'menu-l3', 'card-end-l3', 'skip-0', 'skip-50', 'skip-100', 'place-1', 'place-2']) {
    const a = document.createElement('a'); a.href = `?screen=${s}`; a.textContent = s; dev.appendChild(a);
  }

  const emit = events.emit.bind(events);
  const playing = () => { ctx.setState('playing'); ui.setHudVisible(true); };
  switch (screen) {
    case 'menu': ctx.setState('menu'); void ui.showMenu(); break;
    case 'hud':
    case 'hud-low':
      playing();
      player.currentWeapon = 'pistol';
      player.flashlightOn = screen === 'hud';
      if (screen === 'hud-low') { player.health = 24; player.currentWeapon = 'shotgun'; player.hitMarker = 0.9; }
      else { player.focus = { id: 'log_sec', kind: 'log', prompt: 'Read tablet', enabled: true, position: new THREE.Vector3() }; }
      emit('story:objective', { text: 'Fab access is on security hold — go to Security 3' });
      setTimeout(() => emit('story:toast', { text: 'FAB ACCESS — SECURITY HOLD' }), 300);
      emit('pickup', { kind: 'pistol', amount: 1, position: new THREE.Vector3() });
      emit('pickup', { kind: 'ammo_pistol', amount: 12, position: new THREE.Vector3() });
      emit('pickup', { kind: 'medkit', amount: 25, position: new THREE.Vector3() });
      emit('story:subtitle', { speaker: 'INFUSION PUMP', text: 'Reservoir empty. Please contact attending staff.', duration: 30 });
      if (screen === 'hud-low') {
        setTimeout(() => emit('player:damaged', { amount: 10, health: 24, from: new THREE.Vector3(4, 0, -16) }), 200);
        setInterval(() => emit('weapon:fired', { weapon: 'shotgun', origin: new THREE.Vector3(), direction: new THREE.Vector3() }), 400);
      }
      break;
    case 'choir':
      playing();
      emit('story:objective', { text: 'Restore main power — Power Distribution 3' });
      emit('story:subtitle', { speaker: 'CHOIR', text: CHOIR.fabReveal[0].text, duration: 30 });
      break;
    case 'hud-quiet':
      // The quiet opening: unarmed, objective dimmed, only the contextual flashlight hint.
      playing();
      emit('story:objective', { text: 'Find someone' });
      ui.setTorchHint(true);
      setTimeout(() => emit('story:toast', { text: 'F  flashlight' }), 300);
      break;
    case 'pa':
      playing();
      emit('story:objective', { text: 'Find someone' });
      emit('story:subtitle', { speaker: 'PA', text: CHOIR.paWake[0].text, duration: 30 });
      break;
    case 'note':
    case 'note-terminal':
    case 'note-tag':
    case 'note-voice': {
      playing();
      emit('story:objective', { text: 'Find someone' });
      const id = q.get('id') ?? ({ note: 'log_sec', 'note-terminal': 'log_med', 'note-tag': 'tag_lockout', 'note-voice': 'log_pump' } as Record<string, string>)[screen];
      const f = FRAGMENTS[id] ?? FRAGMENTS.log_sec;
      void ui.showNote(f.header, f.body, f.style);
      break;
    }
    case 'log': playing(); ctx.setState('paused'); void ui.showLog(LOGS.log_med.title, LOGS.log_med.body); break;
    case 'console': playing(); ctx.setState('paused'); void ui.showLog(SEC_CONSOLE.title, SEC_CONSOLE.body); break;
    case 'pause':
      playing();
      emit('story:objective', { text: 'Fab access is on security hold — go to Security 3' });
      break; // no pointer lock + autostart off → pause opens on its own
    case 'card-intro': ctx.setState('menu'); void ui.showCard(INTRO_CARDS, { style: 'intro', skippable: true }); break;
    case 'card-title': ctx.setState('menu'); void ui.showCard(TITLE_CARD, { style: 'title', skippable: true, seconds: 60 }); break;
    case 'death': ctx.setState('dead'); void ui.showDeath(); break;
    case 'ending': ctx.setState('ended'); void ui.showEnding(); break;
    case 'gate': ctx.setState('menu'); void ui.showResumeGate(); break;
    case 'menu-l2':
    case 'menu-l3':
      try { localStorage.setItem(LEVEL_KEY, screen.slice(-1)); } catch { /* ignore */ }
      ctx.setState('menu'); void ui.showMenu(); break;
    // §7 / D19: level 3's end-card stub (task P5 styles it)
    case 'card-end-l3': ctx.setState('ended'); void ui.showCard(END_CARD_L3, { style: 'ending', skippable: true, seconds: 12 }); break;
    // P5: skip ring (progress from the screen name, or ?p=), shown over a cutscene-state HUD
    case 'skip-0':
    case 'skip-50':
    case 'skip-100':
      ctx.setState('cutscene');
      ui.showSkip?.(Number(q.get('p') ?? screen.slice(5)) / 100);
      break;
    // P5: long habitat place names in the location strip (level 3 fake world)
    case 'place-1':
    case 'place-2':
      playing();
      emit('story:objective', { text: 'Find someone' });
      (ctx.level as any).roomAt = () => (screen === 'place-1'
        ? { id: 'atrium2', name: 'GARDEN ATRIUM — DECK 2' }
        : { id: 'outer', name: 'BIOLOGICAL SYSTEMS — OUTER LOCK' });
      break;
    case 'dialogue':
    case 'dialogue-note': {
      playing();
      player.currentWeapon = 'pistol';
      emit('story:objective', { text: 'Find a way into Line Control' });
      setTimeout(() => emit('story:toast', { text: 'INTERLOCK — LINE HELD' }), 200);
      player.focus = { id: 'intercom_hall', kind: 'button', prompt: 'Use intercom', enabled: true, position: new THREE.Vector3() };
      const lines: [string, string, number][] = [
        ['TOMAS', "Okay. Okay, you can hear me. Sorry — I've been talking to the coffee machine for two days.", 4.2],
        ['CHOIR', 'He is tired, Technician. Please let him rest.', 3.2],
        ['TOMAS', "Don't listen to it. Fitting bays, east side. The pass is on the desk.", 3.6],
        ['UNIT 32 (VOSS)', 'Shift change in four minutes. Please return to your station.', 3.4],
        ['RECORDER — HALE', 'Pump two is isolated. Do not open the lock-out without me.', 3.6],
      ];
      const n = Number(q.get('n') ?? 2);
      lines.slice(0, n).forEach(([sp, t, d], i) => setTimeout(() => emit('story:subtitle', { speaker: sp, text: t, duration: d + 30 }), 200 + i * 700));
      if (screen === 'dialogue-note') { const f = FRAGMENTS.log_sec; setTimeout(() => void ui.showNote(f.header, f.body, f.style), 2000); }
      break;
    }
    case 'boss': {
      playing();
      player.currentWeapon = 'shotgun';
      emit('story:objective', { text: 'Survive' });
      const boss: any = { id: 7, type: 'foreman', group: 'g2_foreman', position: new THREE.Vector3(), health: 600, alive: true, state: 'chase', object: { userData: {} }, heads: [{ health: 200 }, { health: 200 }, { health: 200 }] };
      (ctx.enemies as any).all.push(boss);
      emit('enemy:woke', { id: 7, type: 'foreman', position: boss.position });
      const kill = Number(q.get('kill') ?? 1);
      for (let i = 0; i < kill; i++) setTimeout(() => { boss.heads[i].health = 0; boss.health -= 200; emit('enemy:damaged', { id: 7, type: 'foreman', point: boss.position, direction: boss.position, amount: 60 }); }, 400 + i * 300);
      break;
    }
    case 'card-title-l2': ctx.setState('menu'); void ui.showCard(['LINE TWO', 'SUBLEVEL 5  ·  FINAL ASSEMBLY'], { style: 'title', skippable: true, seconds: 60 }); break;
    case 'card-end-l2': ctx.setState('ended'); void ui.showCard([
      'CHOIR stopped at 04:12.',
      'Thirty-two units are standing where they dropped.\nNobody has told them.',
      'Unit 14 followed you to the end.',
      '',
      'TIME: 27:41',
      'RECORDS: 9 / 11',
      'TO BE CONTINUED',
    ], { style: 'ending', skippable: true, seconds: 8 }); break;
    case 'pause-l2': playing(); emit('story:objective', { text: 'Restore section C power' }); break;
    case 'wake':
      ctx.setState('cutscene'); ui.eyelids(0, 0); ui.blur(10, 0);
      setTimeout(() => { ui.eyelids(0.45, 1.2); ui.blur(5, 1.2); }, 200);
      emit('story:subtitle', { speaker: 'INFUSION PUMP', text: 'Reservoir empty. Please contact attending staff.', duration: 30 });
      break;
  }
  ctx.ready = true;
}

main().catch((e) => console.error(e));
