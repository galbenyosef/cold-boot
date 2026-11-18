/**
 * DEV ONLY — level 5 set pieces (stage 3c §8.8, W7): src/level/dev/setpieces5.html
 *   ?view=<name> (see VIEWS below; default floor)   &light=lit|dark (dark = lights_out5: beacons, strips, red points)
 *   &t=<check seconds> (pose TERN's pre-launch check there; −1 = rest)   &run=1 (loop the check in real time)
 *   &quality=low|medium|high   &fov=72   &hud=0   &state=complete
 *   &hatch=<0…1> (both floor hatches)   &look=1 (cmd port silhouette close)   &tally=red|amber|white   &wheel=<0…4 s>
 *   &booth=<0…1>   &gate=<0…1> (d5_gate leaves open)   &dogs=<0…1>
 * window.__sp = { view, light, setTime, check, play, seq, cues, tern, cmd, hatch, wheel, booth, gate, render, stats, step }
 * The rooms are stand-ins at the plan's coordinates (§2.1) — the real shells and dressing are W4's / D1 … D3's.
 */
import * as THREE from 'three';
import type { DynamicBox, GameContext, MaterialName } from '../../core/types';
import { createEvents } from '../../core/events';
import { LevelBuild } from '../context';
import { DoorImpl } from '../doors';
import { defineInstances } from '../props';
import {
  HATCH5_MAG, HATCH5_SPINE, TERN_CHECK_LEN, TERN_CUES, boothBackDoor, cmdDoor, gateLook, hatchLid, launchConsole, launchLockDoor, libOr, tern, wheel5,
  type TernSeq,
} from '../l5/setpieces';

const q = new URLSearchParams(location.search);
const P = (k: string, d: string) => q.get(k) ?? d;

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  if (q.get('hud') === '0') hud.classList.add('off');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(P('fov', '72')), innerWidth / innerHeight, 0.03, 300);
  scene.add(camera);
  const debug = { autostart: true, spawn: null, noEnemies: true, noStory: true, god: false, giveAll: false, quality: (q.get('quality') as never) ?? 'high', verbose: false, fps: 0 };
  const boxes: DynamicBox[] = [];
  const physics = {
    addBox(box: THREE.Box3, surface = 'metal') { const b = { box, enabled: true, surface, remove() {} } as DynamicBox; boxes.push(b); return b; },
    addMover() { return () => {}; }, movers: [],
  };
  const interactables = { add(o: object) { return { ...o }; }, remove() {} };
  const ctx = {
    canvas, uiRoot: document.getElementById('ui')!, scene, camera, events: createEvents(), debug, time: 0, state: 'playing', ready: false, levelId: 5, facts: {},
    physics, interactables, setState() {},
  } as unknown as GameContext;
  (window as any).__game = ctx;
  const { createRender } = await import('../../render');
  const { createMaterials } = await import('../../materials');
  ctx.render = await createRender(ctx);
  ctx.materials = await createMaterials(ctx);
  const M = ctx.materials;
  const pick = (n: MaterialName, fb: MaterialName): MaterialName => (M.get(n).name === n ? n : fb);

  const L = new LevelBuild(ctx);
  scene.add(L.root);
  defineInstances(L);
  // navy-dock stand-ins until W5 lands (§8.9 descriptions)
  const HULLW = libOr(L, 'hull_white', 'wall_medical', { color: 0xcfcbc0, roughness: 0.55 });
  const GRATE = libOr(L, 'deck_grate', 'floor_grate');
  const DECK = pick('deck_nonslip', 'floor_plate'), NAVY = pick('navy_grey', 'wall_panel');
  const solid = (b: ReturnType<LevelBuild['builder']>, m: Parameters<typeof b.bx>[0], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => b.bx(m, x0, y0, z0, x1, y1, z1);
  const stripMat = M.clone('plastic_white', { color: 0xb9cbe0, emissive: new THREE.Color(0xff3a20), emissiveIntensity: 0, roughness: 0.3, map: null, normalMap: null });

  // ── SUB BAY (x 22 … 46, z −56 … −18, h 12) + galleries y 4.8 + bridge
  L.currentRoom = 'sub5';
  L.room('sub5', 'SUB BAY', 22, 46, -56, -18, 12, { y0: 0, floors: [{ y: 4.8, box: [22.2, 25.0, -55.8, -18.2] }, { y: 4.8, box: [43.0, 45.8, -55.8, -18.2] }, { y: 4.8, box: [25.0, 43.0, -21.0, -18.2] }, { y: 4.8, box: [25.0, 43.0, -36.0, -34.0] }] });
  const sb = L.builder('sub5_static');
  solid(sb, DECK, 22, -0.2, -56, 46, 0, -18);
  solid(sb, HULLW, 21.6, 0, -56.2, 22.2, 12, -17.8); solid(sb, HULLW, 45.8, 0, -56.2, 46.4, 12, -17.8);
  solid(sb, HULLW, 22, 0, -56.2, 46, 12, -55.8); solid(sb, HULLW, 22, 0, -18.2, 46, 12, -17.8);
  solid(sb, 'ceiling_panel', 21.6, 12, -56.2, 46.4, 12.3, -17.8);
  // hull ribs on the long walls every 3 m
  for (let z = -54; z <= -20; z += 3) for (const x of [22.25, 45.75]) sb.box(NAVY, x, 6, z, 0.12, 12, 0.3);
  const gal = (x0: number, x1: number, z0: number, z1: number) => { sb.bx(GRATE, x0, 4.75, z0, x1, 4.8, z1); sb.bx('steel_raw', x0, 4.6, z0, x1, 4.65, z1); };
  gal(22.2, 25.0, -55.8, -18.2); gal(43.0, 45.8, -55.8, -18.2); gal(25.0, 43.0, -21.0, -18.2); gal(25.0, 43.0, -36.0, -34.0);
  // rails (1.1 m) on the inner edges + strips on the gallery edges
  const rail = (ax: number, az: number, bx: number, bz: number) => { sb.rod('trim_steel', ax, 5.9, az, bx, 5.9, bz, 0.025, 6); sb.rod('trim_steel', ax, 5.35, az, bx, 5.35, bz, 0.02, 6); sb.bx(stripMat, Math.min(ax, bx) - 0.02, 4.8, Math.min(az, bz) - 0.02, Math.max(ax, bx) + 0.02, 4.83, Math.max(az, bz) + 0.02); };
  rail(25.0, -55.8, 25.0, -36.0); rail(25.0, -34.0, 25.0, -21.0); rail(43.0, -55.8, 43.0, -36.0); rail(43.0, -34.0, 43.0, -21.0);
  rail(25.0, -21.0, 43.0, -21.0); rail(25.0, -36.0, 43.0, -36.0); rail(25.0, -34.0, 32.0, -34.0); rail(36.0, -34.0, 43.0, -34.0);
  for (let x = 25.5; x < 43; x += 1.5) for (const z of [-34, -36, -21]) sb.rod('trim_steel', x, 4.8, z, x, 5.9, z, 0.02, 5);
  // the D-task boxes beside the cradle (W8 owns the real ones): equipment boxes EW1/EW2/EE1/EE2 stand-ins
  for (const [x0, x1, z0, z1] of [[30.4, 31.6, -33, -31], [30.4, 31.6, -41, -39], [36.4, 37.6, -33, -31], [36.4, 37.6, -41, -39]]) sb.bx('painted_dark', x0, 0, z0, x1, 1.3, z1);
  // north wall board and the tunnel door frame (stand-ins)
  sb.bx('painted_dark', 32.5, 6.6, -18.2, 35.5, 7.8, -18.15);
  L.screen('tern_board', 'dock_status', 2.8, 1.0, 34, 7.2, -18.14, '+z', { text: 'TERN — CRADLE — LAUNCH READY' });
  sb.bx('hazard_stripes', 22.2, 0, -54.8, 22.4, 2.8, -51.2);
  const sub = tern(L, { builder: sb, state: q.get('state') === 'complete' ? 'complete' : 'rest' });
  launchLockDoor(L, sb);
  launchConsole(L, sb);
  wheel5(L, sb);
  // lights: lit
  const lit: ReturnType<LevelBuild['point']>[] = [];
  lit.push(L.spot('sub5', 30, 11.5, -26, 34, 1, -36, 0xfff1dc, 420, 34, 0.6, { cast: true, priority: 0.8, penumbra: 0.6 }));
  lit.push(L.spot('sub5', 38, 11.5, -44, 34, 4.8, -35, 0xfff1dc, 300, 30, 0.6, { cast: true, priority: 0.8, penumbra: 0.6 }));
  lit.push(L.point('sub5', 24, 8, -20, 0xfff1dc, 60, 26), L.point('sub5', 44, 8, -20, 0xfff1dc, 60, 26));
  lit.push(L.point('sub5', 27, 6.5, -50, 0xfff1dc, 45, 22, { priority: 0.6 }), L.point('sub5', 41, 6.5, -50, 0xfff1dc, 45, 22, { priority: 0.6 }));
  const dark: ReturnType<LevelBuild['point']>[] = [];
  dark.push(L.point('sub5_emerg', 34, 9, -18.6, 0xff8a1e, 16, 26, { flicker: 'alarm', enabled: false }), L.point('sub5_emerg', 34, 9, -55.4, 0xff8a1e, 16, 26, { flicker: 'alarm', enabled: false }));
  dark.push(L.point('sub5_emerg', 22.6, 3.0, -53, 0xff2a18, 3, 8, { enabled: false }));

  // ── SPINE end (x 34 … 44 of spine5, z −18 … −14): the hatch pit, the command-module door, the line
  L.currentRoom = 'spine5';
  L.room('spine5', 'THE SPINE', 34, 44, -18, -14, 3.2, { y0: 0 });
  const pb = L.builder('spine5_static');
  const HX0 = HATCH5_SPINE.x0, HX1 = HATCH5_SPINE.x1, HZ0 = HATCH5_SPINE.z0, HZ1 = HATCH5_SPINE.z1;
  solid(pb, DECK, 34, -0.2, -18, HX0, 0, -14); solid(pb, DECK, HX1, -0.2, -18, 44, 0, -14);
  solid(pb, DECK, HX0, -0.2, -18, HX1, 0, HZ0); solid(pb, DECK, HX0, -0.2, HZ1, HX1, 0, -14);
  solid(pb, 'painted_dark', HX0, -1.6, HZ0, HX1, -1.4, HZ1);
  solid(pb, 'painted_dark', HX0 - 0.05, -1.4, HZ0, HX0, 0, HZ1); solid(pb, 'painted_dark', HX1, -1.4, HZ0, HX1 + 0.05, 0, HZ1);
  solid(pb, 'painted_dark', HX0, -1.4, HZ0 - 0.05, HX1, 0, HZ0);
  solid(pb, HULLW, 34, 0, -14.2, 44, 3.2, -13.8); solid(pb, HULLW, 34, 0, -18.2, 44, 3.2, -17.8);
  solid(pb, HULLW, 43.8, 0, -18.2, 44.2, 3.2, -17.25); solid(pb, HULLW, 43.8, 0, -14.75, 44.2, 3.2, -13.8); solid(pb, HULLW, 43.8, 3.0, -17.25, 44.2, 3.2, -14.75);
  solid(pb, 'ceiling_panel', 34, 3.2, -18.2, 44.2, 3.4, -13.8);
  for (let x = 35; x < 44; x += 3) pb.box(NAVY, x, 2.9, -16, 0.12, 0.3, 4);
  cmdDoor(L, pb);
  hatchLid(L, pb, HATCH5_SPINE);
  const spLit = [L.point('spine5', 37, 2.9, -16, 0xfff1dc, 10, 9), L.point('spine5', 41.5, 2.9, -16, 0xfff1dc, 8, 8)];
  const spDark = [L.point('spine5_emerg', 40, 2.8, -15, 0xff2a18, 2.2, 7, { enabled: false })];

  // ── ARMOURY corner (x 14 … 22, z −28 … −18) with the magazine hatch; the magazine below (y −2.6)
  L.currentRoom = 'arm5';
  L.room('arm5', 'ARMOURY', 14, 22, -28, -18, 3.2, { y0: 0 });
  const ab = L.builder('arm5_static');
  const MX0 = HATCH5_MAG.x0, MX1 = HATCH5_MAG.x1, MZ0 = HATCH5_MAG.z0, MZ1 = HATCH5_MAG.z1;
  solid(ab, DECK, 14, -0.2, -28, MX0, 0, -18); solid(ab, DECK, MX1, -0.2, -28, 22, 0, -18);
  solid(ab, DECK, MX0, -0.2, -28, MX1, 0, MZ0); solid(ab, DECK, MX0, -0.2, MZ1, MX1, 0, -18);
  solid(ab, HULLW, 21.8, -2.6, -28.2, 22.2, 3.2, -17.8); solid(ab, HULLW, 13.8, 0, -28.2, 14.2, 3.2, -17.8); solid(ab, HULLW, 14, -2.6, -28.2, 22, 3.2, -27.8);
  solid(ab, 'ceiling_panel', 14, 3.2, -28.2, 22, 3.4, -17.8);
  solid(ab, 'painted_dark', 18.4, -2.8, -28, 21.8, -2.6, -22.4); solid(ab, 'painted_dark', 18.4, -2.6, -28, 18.6, 0, -22.4);
  // magazine exit stair (stand-in treads) under the hatch
  for (let i = 0; i < 9; i++) ab.bx('steel_raw', MX0, -2.6 + (i + 1) * 0.2889 - 0.03, -27.0 + i * 0.3, MX1, -2.6 + (i + 1) * 0.2889, -27.0 + (i + 1) * 0.3);
  hatchLid(L, ab, HATCH5_MAG);
  const armLit = [L.point('arm5', 18, 2.9, -22, 0xfff1dc, 10, 10), L.point('arm5', 20.5, -1.0, -25.5, 0xffd0a0, 3, 5, { bounds: new THREE.Box3(new THREE.Vector3(18, -3, -28), new THREE.Vector3(22, -0.1, -22)) })];

  // ── GATEHOUSE east wall with the booth back door; the gate (d5_gate, a real wide door) between lock5 and gate5
  L.currentRoom = 'gate5';
  L.room('gate5', 'POST 4 — GATEHOUSE', -6, 6, -10, 0, 3.4, { y0: 0 });
  L.room('lock5', 'POST 4 — GATE LOCK', -3, 3, 0, 6, 3.6, { y0: 0 });
  const gb = L.builder('gate5_static');
  solid(gb, DECK, -6, -0.2, -10, 6, 0, 6);
  solid(gb, NAVY, 5.8, 0, -10, 6.2, 3.4, 0); solid(gb, NAVY, -6.2, 0, -10, -5.8, 3.4, 0); solid(gb, NAVY, -6, 0, -10.2, 6, 3.4, -9.8);
  solid(gb, NAVY, -3.2, 0, 0, -2.8, 3.6, 6); solid(gb, NAVY, 2.8, 0, 0, 3.2, 3.6, 6); solid(gb, NAVY, -3, 0, 5.8, 3, 3.6, 6.2);
  solid(gb, NAVY, -6, 0, -0.2, -1.5, 3.4, 0.2); solid(gb, NAVY, 1.5, 0, -0.2, 6, 3.4, 0.2); solid(gb, NAVY, -1.5, 2.8, -0.2, 1.5, 3.4, 0.2);
  solid(gb, 'ceiling_panel', -6.2, 3.4, -10.2, 6.2, 3.7, 0.2); solid(gb, 'ceiling_panel', -3.2, 3.6, 0, 3.2, 3.9, 6.2);
  // booth stand-in: kerb, counter, the palm-plate screen position (W5/D1 own the real booth)
  gb.bx('painted_dark', 2.4, 0, -4.0, 2.6, 1.0, -0.2);
  gb.bx(NAVY, 4.3, 0, -2.6, 5.0, 1.05, -1.4);
  L.screen('aas_palm', 'palm', 0.16, 0.2, 4.6, 1.15, -2.0, '-x', { text: 'amber|done|AAS, L. (LT.) — PALM — LIVE|1.6' });
  boothBackDoor(L, gb, { open: Number(P('booth', '0.35')) });
  gateLook(L, 'd5_gate', { dogs: 12 });
  const gLit = [L.point('gate5', 0, 3.1, -4, 0xfff1dc, 14, 12), L.point('gate5', 4.2, 2.4, -2.0, 0xfff1dc, 3, 5), L.point('lock5', 0, 3.2, 3, 0xfff1dc, 10, 8)];
  L.currentRoom = '';
  L.finishLightBounds();
  const frames = L.builder('door_frames'); frames.rooms = ['gate5', 'lock5'];
  const gate = new DoorImpl(L, { id: 'd5_gate', x: 0, z: 0, wall: 'z', kind: 'wide', locked: false, labelFront: 'POST 4', labelBack: 'GATEHOUSE', rooms: ['lock5', 'gate5'], auto: false, leafMat: 'navy_grey' }, frames);
  L.doors.set('d5_gate', gate);
  for (const f of L.afterDoors) f();
  L.finishBuilders();
  void spLit; void armLit; void gLit;

  // ── views [eye, target]
  const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const VIEWS: Record<string, [THREE.Vector3, THREE.Vector3, number?]> = {
    floor: [V3(34, 1.65, -19.6), V3(34, 2.4, -36)],
    floor_side: [V3(28.3, 1.65, -40.5), V3(34, 2.5, -34.5)],
    floor_e: [V3(41.0, 1.65, -29.0), V3(34, 2.2, -36.0)],
    floor_bow: [V3(36.2, 1.65, -49.5), V3(34, 2.3, -40.5)],
    floor_stern: [V3(37.8, 1.65, -23.2), V3(34, 2.2, -29.5)],
    gallery_n: [V3(34, 6.45, -20.2), V3(34, 2.6, -35)],
    gallery_w: [V3(23.6, 6.45, -40.5), V3(34, 2.8, -34)],
    gallery_e: [V3(44.4, 6.45, -27.0), V3(34, 2.8, -35)],
    bridge: [V3(32.6, 6.45, -35.0), V3(34, 3.9, -30.6)],
    bridge_s: [V3(32.8, 6.45, -35.4), V3(34, 2.0, -46)],
    hatch: [V3(35.5, 5.6, -33.4), V3(34, 4.55, -31.3), 50],
    sail_e: [V3(38.6, 5.4, -28.6), V3(34, 3.4, -32.2)],
    sail_w: [V3(28.8, 3.2, -34.8), V3(34, 3.4, -31.6)],
    thrusters: [V3(37.8, 1.9, -27.6), V3(34.3, 1.8, -30.0)],
    tail: [V3(36.5, 2.6, -22.5), V3(34, 2.1, -27.6)],
    clamps: [V3(38.6, 1.75, -37.6), V3(35.4, 1.5, -35.6)],
    dome: [V3(35.4, 2.1, -46.2), V3(34, 2.2, -42.8)],
    lock: [V3(34.5, 1.65, -45.5), V3(34, 2.9, -56)],
    lock_port: [V3(34.3, 1.9, -52.5), V3(34, 2.2, -56), 40],
    console: [V3(34, 6.45, -35.15), V3(34, 5.75, -34.3)],
    wheel: [V3(24.4, 6.45, -50.6), V3(22.4, 5.9, -52)],
    cmd: [V3(39.6, 1.65, -16.0), V3(44, 1.5, -16)],
    cmd_port: [V3(42.5, 1.65, -16.05), V3(43.8, 1.62, -16), 30],
    cmd_line: [V3(38.6, 2.0, -15.4), V3(43.0, 0.3, -16.2)],
    hatch_spine: [V3(37.6, 1.65, -14.45), V3(37.4, 0.0, -16.8)],
    hatch_spine_far: [V3(41.5, 1.65, -14.6), V3(37.4, 0.4, -16.5)],
    hatch_mag: [V3(19.2, 1.65, -22.6), V3(21.0, 0.2, -25.8)],
    hatch_mag_under: [V3(20.6, -0.95, -27.35), V3(21.0, -0.1, -25.4)],
    booth: [V3(0.6, 1.65, -2.4), V3(5.8, 1.2, -3.2)],
    gate: [V3(0, 1.65, 4.6), V3(0, 1.4, 0)],
  };
  let view = P('view', 'floor');
  const setView = (name: string) => {
    const v = VIEWS[name] ?? VIEWS.floor;
    view = name;
    camera.fov = v[2] ?? Number(P('fov', '72')); camera.updateProjectionMatrix();
    camera.position.copy(v[0]); camera.lookAt(v[1]); camera.updateMatrixWorld();
  };
  setView(view);
  let mode = P('light', 'lit');
  const setLight = (m: string) => {
    mode = m;
    const d = m === 'dark';
    for (const h of lit) h.enabled = !d;
    for (const h of spLit) h.enabled = !d;
    for (const h of dark) h.enabled = d;
    for (const h of spDark) h.enabled = d;
    stripMat.emissiveIntensity = d ? 1.2 : 0;
    (cmd.userData.lineGlow as (k: number) => void)(d ? 1 : 0);
  };

  const T = sub.userData as { seq: TernSeq; check(): void; snap(): void; setTime(t: number): void; play(): void; onCue(cb: (c: string, s: TernSeq) => void): () => void; clamps(k: number | null): void; hatch(k: number | null): void };
  const cmd = L.objects.get('door5_cmd')!;
  const C = cmd.userData as { look(on: boolean): void; tally(s: string): void; pulse(on: boolean): void; lineGlow(k: number): void };
  const hs = L.objects.get('hatch5_spine')!.userData as { open(k: number): void; dogs(k: number): void };
  const hm = L.objects.get('hatch5_mag')!.userData as { open(k: number): void; dogs(k: number): void; lamp(s: string): void };
  const W5 = L.objects.get('wheel5')!.userData as { spin(t: number): void };
  const BD = L.objects.get('booth5_backdoor')!.userData as { set(k: number): void; settle(s?: number, cb?: () => void): void };
  const GD = L.objects.get('d5_gate_dogs')!.userData as { set(k: number): void };
  setLight(mode);
  const cueLog: string[] = [];
  T.onCue((c, s) => cueLog.push(`${c}@${s.t.toFixed(2)}`));
  if (q.get('hatch') !== null) { const k = Number(q.get('hatch')); hs.open(k); hs.dogs(k > 0 ? 1 : 0); hm.open(k); hm.dogs(k > 0 ? 1 : 0); hm.lamp(k > 0 ? 'green' : 'red'); }
  if (q.get('look') === '1') C.look(true);
  if (q.get('tally')) C.tally(q.get('tally')!);
  if (q.get('pulse') === '1') C.pulse(true);
  if (q.get('wheel') !== null) W5.spin(Number(q.get('wheel')));
  if (q.get('dogs') !== null) GD.set(Number(q.get('dogs')));
  if (q.get('gate') !== null) { gate.open(); gate.snap(); }

  let time = 0;
  const update = (dt: number) => { time += dt; ctx.time = time; L.updateTasks(dt); for (const u of L.updaters) u(dt, time); gate.update(dt, ctx); M.update(dt); };
  const tParam = q.get('t');
  let run = q.get('run') === '1';
  let paused = tParam !== null && !run;
  if (tParam !== null) { T.setTime(Number(tParam)); }
  let restart = -1;
  if (run) { T.setTime(tParam !== null ? Number(tParam) : 0); T.play(); }

  await ctx.render.prepare([V3(34, 2, -24), V3(34, 2, -48), V3(34, 6.4, -35), V3(40, 1.6, -16), V3(18, 1.6, -23), V3(0, 1.6, -4)]);
  // warm the cmd door / lamps once even when paused
  update(1 / 60);
  if (tParam !== null) T.setTime(Number(tParam));
  (window as any).__sp = {
    view: setView, light: setLight, views: Object.keys(VIEWS),
    setTime(t: number) { T.setTime(t); run = false; paused = true; },
    check() { T.check(); run = true; paused = false; },
    play() { T.play(); run = true; paused = false; },
    seq: () => ({ ...T.seq }), cues: () => ({ ...TERN_CUES, length: TERN_CHECK_LEN }),
    tern: T, cmd: C, hatch: (k: number) => { hs.open(k); hm.open(k); }, hatchDogs: (k: number) => { hs.dogs(k); hm.dogs(k); }, hatchLamp: (s: string) => hm.lamp(s),
    wheel: (t: number) => W5.spin(t), booth: BD, gate: { open: () => gate.open(), close: () => gate.close(), dogs: (k: number) => GD.set(k) },
    step(dt: number, n = 1) { for (let i = 0; i < n; i++) update(dt); },
    render: () => { ctx.render.render(0); },
    stats: () => { const r = ctx.renderer.info.render; return { calls: r.calls, tris: r.triangles }; },
    pause(p: boolean) { paused = p; },
    log: cueLog,
  };

  let last = performance.now(), acc = 0, frames2 = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = Math.min((now - last) / 1000, 0.1); last = now;
    acc += raw; frames2++;
    if (acc > 0.5) { debug.fps = Math.round(frames2 / acc); acc = 0; frames2 = 0; }
    if (!paused) update(raw);
    if (run && T.seq.state === 'complete') {
      if (restart < 0) restart = time + 3;
      else if (time > restart) { restart = -1; T.check(); }
    }
    ctx.render.render(paused ? 0 : raw);
    const s = T.seq, r = ctx.renderer.info.render;
    hud.textContent = `W7 set pieces — view ${view}  light ${mode}  ${paused ? 'paused' : run ? 'check running' : 'live'}  fps ${debug.fps}  calls ${r.calls}  tris ${r.triangles}\n` +
      `TERN: t ${s.t.toFixed(2)} / ${s.duration}  state ${s.state}  cue ${s.cue}\n${cueLog.slice(-7).join('  ')}`;
  };
  ctx.render.render(0);
  ctx.ready = true;
  requestAnimationFrame((t) => { last = t; frame(t); });
}

main().catch((e) => { console.error(e); (window as any).__game = { ready: true, debug: { fps: 0 } }; });
