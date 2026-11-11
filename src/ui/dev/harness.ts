/**
 * Isolated UI harness: dev/ui.html?screen=<name>. A fake GameContext over a painted "photo-like" dark
 * industrial backdrop so every UI screen can be iterated without the 3D game.
 * Screens: menu hud choir log console pause card-intro card-title death ending gate wake
 */
import * as THREE from 'three';
import type { GameContext, GameState, WeaponState } from '../../core/types';
import { createEvents } from '../../core/events';
import { createInput } from '../../core/input';
import { createUI } from '../index';
import type { UIInternal } from '../types';
import { LOGS, SEC_CONSOLE, CHOIR, INTRO_CARDS, TITLE_CARD } from '../../story/text';

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
    debug: { autostart: screen !== 'pause', spawn: null, noEnemies: true, noStory: true, god: true, giveAll: false, quality: null, verbose: false, fps: 60 },
    time: 0, state: 'loading' as GameState, ready: false,
    setState(s: GameState) { if (s === ctx.state) return; const prev = ctx.state; ctx.state = s; events.emit('game:state', { state: s, prev }); },
    player,
    audio: { async unlock() {}, play() {}, loop() { return { setVolume() {}, setPosition() {}, stop() {} }; }, setMusic() {}, setRoom() {}, choirVoice() {}, setMasterVolume() {}, setMuffle() {}, update() {} },
    render: { quality: 'high', setQuality(qq: string) { (this as any).quality = qq; }, post: { fade() {}, glitch() {}, damage() {}, setLowHealth() {}, setExposure() {} } },
    level: { roomAt: () => ({ id: 'junction', name: 'JUNCTION 3' }), object: () => undefined, screen: () => undefined },
    story: { objective: 'Fab access is on security hold — go to Security 3', logs: new Set(['log_med']), stats, lateUpdate() {}, update() {}, async run() {} },
    interactables: { get: () => undefined },
  } as unknown as GameContext;
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
  for (const s of ['menu', 'hud', 'hud-low', 'choir', 'log', 'console', 'pause', 'card-intro', 'card-title', 'death', 'ending', 'gate', 'wake']) {
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
      emit('story:subtitle', { speaker: 'CHOIR', text: CHOIR.fabReveal[1].text, duration: 30 });
      break;
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
    case 'wake':
      ctx.setState('cutscene'); ui.eyelids(0, 0); ui.blur(10, 0);
      setTimeout(() => { ui.eyelids(0.45, 1.2); ui.blur(5, 1.2); }, 200);
      emit('story:subtitle', { speaker: 'INFUSION PUMP', text: 'Reservoir empty. Please contact attending staff.', duration: 30 });
      break;
  }
  ctx.ready = true;
}

main().catch((e) => console.error(e));
