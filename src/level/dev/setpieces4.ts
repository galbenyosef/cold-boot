/**
 * DEV ONLY — level 4 set pieces (stage 3b §8.5 W9a): src/level/dev/setpieces4.html
 *   ?view=gallery|gallery_w|gallery_e|close|tool|bath|bin|arm|top|clasps|clasps_far|bodies|body:<pose>|gurney
 *   &t=<cycle seconds> (pose the arm there)   &run=1 (let the cycle run in real time; default when no t)
 *   &failhold=<s>   &quality=low|medium|high   &park=1 (setMachine off)   &fov=72
 * window.__sp = { setTime(t), view(name), arm, cycle(), cues() } for frame strips (see the W9a report).
 * The theatre and gallery shells are stand-ins at the plan's coordinates (§2.1, §2.6) — the real ones are D2's.
 */
import * as THREE from 'three';
import type { GameContext, MaterialName } from '../../core/types';
import { createEvents } from '../../core/events';
import { LevelBuild } from '../context';
import {
  body, BODY_POSES, claspBin, claspInst, clasp, defineClaspInstances, gelBath, orTable, theatreArm, type ArmCycle, type BodyPose, type LedState,
} from '../l4/setpieces';

const q = new URLSearchParams(location.search);
const P = (k: string, d: string) => q.get(k) ?? d;

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(P('fov', '72')), innerWidth / innerHeight, 0.02, 200);
  scene.add(camera);
  const debug = { autostart: true, spawn: null, noEnemies: true, noStory: true, god: false, giveAll: false, quality: (q.get('quality') as never) ?? 'high', verbose: false, fps: 0 };
  const ctx = {
    canvas, uiRoot: document.getElementById('ui')!, scene, camera, events: createEvents(), debug, time: 0, state: 'playing', ready: false, levelId: 4, facts: {},
    setState() {},
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
  const WALL = pick('wall_clean', 'wall_medical'), FLOOR = pick('floor_epoxy', 'floor_rubber'), CEIL = pick('ceiling_clean', 'ceiling_panel');

  // ── theatre (x −8 … 8, z −59 … −47, floor 0, h 9.4) + gallery (y 4.8, z −47 … −43) stand-ins
  L.currentRoom = 'theatre';
  L.room('theatre', 'THEATRE 1', -8, 8, -59, -47, 9.4, { y0: 0 });
  L.room('gallery', 'THEATRE 1 — GALLERY', -10, 10, -47, -43, 3.0, { y0: 4.8 });
  const zb = L.builder('theatre_static');
  zb.bx(FLOOR, -8, -0.2, -59, 8, 0, -47);
  zb.bx(WALL, -8.2, 0, -59.2, -7.8, 9.4, -46.8).bx(WALL, 7.8, 0, -59.2, 8.2, 9.4, -46.8).bx(WALL, -8, 0, -59.2, 8, 9.4, -58.8);
  zb.bx(CEIL, -8.2, 9.4, -59.2, 8.2, 9.7, -46.8);
  // gallery wall under / beside / over the glazing (z −47), the gallery floor slab
  zb.bx(WALL, -8, 0, -47.2, 8, 5.0, -46.8).bx(WALL, -8, 7.6, -47.2, 8, 9.4, -46.8);
  zb.bx(WALL, -8, 5.0, -47.2, -7.6, 7.6, -46.8).bx(WALL, 7.6, 5.0, -47.2, 8, 7.6, -46.8);
  zb.bx(FLOOR, -10, 4.5, -47, 10, 4.8, -43).bx(WALL, -10, 4.8, -43.2, 10, 7.8, -42.8).bx(CEIL, -10, 7.8, -47, 10, 8.0, -43);
  zb.box('screen_off', 0, 3.7, -58.79, 4.0, 1.4, 0.02);
  // set: table + Strand, gel bath, bin, two covered gurneys (§2.6)
  zb.at(0, 0, -53.5, 0, () => orTable(zb, L));
  const strand = body(L, zb, 'prone_table', 'Strand', { x: 0, y: 0, z: -53.5, nape: [-0.7, 1.08, -53.5] });
  zb.at(-2.5, 0, -56.8, 0, () => gelBath(zb, L));
  zb.at(2.2, 0, -51.5, 0, () => claspBin(zb, L, 30));
  body(L, zb, 'covered_gurney', 'Haugen', { x: 5.5, y: 0, z: -50.2, ry: 0.06 });
  body(L, zb, 'covered_gurney', 'Lie', { x: 5.5, y: 0, z: -56.0, ry: -0.04 });
  // surgical lamp stand-in (D2 owns the real one)
  zb.cyl('plastic_white', 0.4, 3.4, -53.2, 0.32, 0.12, 'y', 24).rod('trim_steel', 0.4, 3.45, -53.2, 0.4, 9.4, -53.2, 0.03, 8);
  zb.cyl('emissive_white', 0.4, 3.335, -53.2, 0.26, 0.01, 'y', 24);
  const arm = theatreArm(L, new THREE.Vector3(-1.7, 9.2, -54.5), { builder: zb, failHold: Number(P('failhold', '2.5')) });
  L.spot('theatre', 0.4, 3.3, -53.2, -0.4, 0.9, -53.5, 0xf4f7ff, 28, 9, 0.62, { cast: true, priority: 2.0, penumbra: 0.5 });
  L.point('theatre', 0, 8.6, -52.5, 0xdfe8ff, 20, 16);
  L.point('theatre', 4, 6.0, -56, 0xdfe8ff, 8, 12, { priority: 0.6 });
  L.point('theatre', -4.5, 4.0, -53, 0xdfe8ff, 12, 10, { priority: 0.6 }); // dev fill (the real light plan is D2's)
  L.point('gallery', 0, 7.5, -45, 0xdfe8ff, 3.5, 8, { priority: 0.4 });

  // ── line-up room (x 14 … 32, z −60 … −42): every body pose + the Clasp shelf
  L.currentRoom = 'lineup';
  L.room('lineup', 'LINE-UP', 14, 32, -60, -42, 4.0, { y0: 0 });
  const lb = L.builder('lineup_static');
  lb.bx(FLOOR, 14, -0.2, -60, 32, 0, -42).bx(WALL, 14, 0, -60.2, 32, 4, -59.8).bx(WALL, 13.8, 0, -60, 14.2, 4, -42);
  lb.bx(CEIL, 14, 4, -60, 32, 4.2, -42);
  // row along z −58 (wall behind at z −59.8)
  const at: Record<string, THREE.Vector3> = {};
  const put = (pose: BodyPose, name: string, x: number, z: number, o: Partial<Parameters<typeof body>[4]> = {}) => {
    const info = body(L, lb, pose, name, { x, y: 0, z, ...o });
    at[o.suitHalfOff ? 'eng' : pose] = new THREE.Vector3(x, 0, z);
    return info;
  };
  put('slumped_wall', 'Dahl', 16.0, -59.45, { ry: 0 });
  put('lying_back', 'Holm', 19.5, -57.5, { ry: PI2, armOut: [18.42, 0.05, -57.75] });
  put('lying_side', 'Berg', 23.0, -57.5, { ry: -PI2 });
  put('lying_side', 'Eng', 26.5, -57.5, { ry: -PI2, suitHalfOff: true });
  // desk for Ness (top 0.75, front edge 0.4 ahead of the body origin)
  lb.bx('plastic_white', 28.6, 0.72, -57.2, 31.0, 0.75, -56.2);
  for (const x of [28.7, 30.9]) for (const z of [-57.15, -56.25]) lb.bx('trim_steel', x - 0.02, 0, z - 0.02, x + 0.02, 0.72, z + 0.02);
  put('sitting_desk', 'Ness', 29.8, -57.6, { ry: 0 });
  lb.at(18.5, 0, -50, 0, () => orTable(lb, L));
  put('prone_table', 'Moe', 18.5, -50, { nape: [18.5 - 0.7, 1.08, -50] });
  put('covered_gurney', 'Lie', 23, -50, { ry: 0 });
  // Clasp shelf: 4 static states, then instanced rows (amber / red blinking / off)
  defineClaspInstances(L);
  lb.bx('trim_steel', 26.0, 0.97, -50.3, 28.0, 1.0, -49.7);
  const states: LedState[] = ['amber', 'red', 'red_solid', 'off'];
  states.forEach((s, i) => lb.at(26.3 + i * 0.12, 1.0, -50.0, 0, () => { lb.push(0, 0.012, 0, 0, -Math.PI / 2, 0); clasp(lb, L, s, 0.1 * i); lb.pop(); }));
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) claspInst(lb, 26.95 + i * 0.11, 1.15 + r * 0.1, -50.25, 0, 0, 0, states[r]);
  lb.bx('trim_steel', 26.85, 1.08, -50.32, 27.65, 1.42, -50.28);
  L.point('lineup', 20, 3.6, -54, 0xe8f0ff, 22, 14);
  L.point('lineup', 28, 3.6, -52, 0xe8f0ff, 16, 12);
  L.spot('lineup', 24, 3.8, -48, 24, 0, -56, 0xf4f7ff, 30, 16, 0.9, { cast: true });
  L.currentRoom = '';
  L.finishLightBounds();
  L.finishBuilders();

  // ── views
  const nape = new THREE.Vector3(-0.7, 1.08, -53.5);
  const V: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    gallery: [new THREE.Vector3(0, 6.45, -46.0), nape.clone().add(new THREE.Vector3(-0.6, 0.6, 0))],
    gallery_look: [new THREE.Vector3(0, 6.45, -46.0), nape],
    gallery_w: [new THREE.Vector3(-6.5, 6.45, -46.0), new THREE.Vector3(-1.2, 2.2, -54)],
    gallery_e: [new THREE.Vector3(6.5, 6.45, -46.0), new THREE.Vector3(-0.8, 2.2, -54)],
    close: [new THREE.Vector3(-0.2, 1.85, -52.3), nape],
    tool: [new THREE.Vector3(-0.55, 1.36, -52.95), nape.clone().add(new THREE.Vector3(0, 0.06, 0))],
    bath: [new THREE.Vector3(-1.0, 2.1, -55.4), new THREE.Vector3(-2.5, 1.1, -56.8)],
    bin: [new THREE.Vector3(2.6, 1.55, -50.6), new THREE.Vector3(2.2, 0.6, -51.5)],
    arm: [new THREE.Vector3(7.2, 4.6, -50.0), new THREE.Vector3(-1.5, 4.2, -54.8)],
    top: [new THREE.Vector3(0.5, 8.9, -48.5), new THREE.Vector3(-1.0, 0.5, -54.5)],
    clasps: [new THREE.Vector3(26.48, 1.17, -49.7), new THREE.Vector3(26.48, 1.01, -50.0)],
    clasp1: [new THREE.Vector3(26.36, 1.07, -49.88), new THREE.Vector3(26.3, 1.01, -50.0)],
    rack: [new THREE.Vector3(27.25, 1.25, -49.55), new THREE.Vector3(27.25, 1.25, -50.25)],
    clasps_far: [new THREE.Vector3(27.0, 1.6, -46.0), new THREE.Vector3(27.0, 1.1, -50.1)],
    bodies: [new THREE.Vector3(23, 3.7, -48.5), new THREE.Vector3(23, 0.2, -56.5)],
    gurney: [new THREE.Vector3(3.6, 2.4, -48.6), new THREE.Vector3(5.5, 0.8, -50.4)],
  };
  for (const p of BODY_POSES) {
    const c = at[p] ?? at.slumped_wall;
    V[`body:${p}`] = [c.clone().add(new THREE.Vector3(1.4, 1.5, 1.6)), c.clone().add(new THREE.Vector3(0, 0.35, -0.3))];
  }
  V['body:eng'] = [at.eng.clone().add(new THREE.Vector3(1.2, 1.4, 1.5)), at.eng.clone().add(new THREE.Vector3(0, 0.3, 0))];
  V['body:holm_top'] = [at.lying_back.clone().add(new THREE.Vector3(0, 2.6, 0.01)), at.lying_back.clone()];
  V['body:dahl_side'] = [at.slumped_wall.clone().add(new THREE.Vector3(1.6, 0.9, 0.9)), at.slumped_wall.clone().add(new THREE.Vector3(0, 0.45, 0.2))];
  V['body:ness_side'] = [at.sitting_desk.clone().add(new THREE.Vector3(-1.7, 1.2, 0.5)), at.sitting_desk.clone().add(new THREE.Vector3(0, 0.7, 0.2))];
  let view = P('view', 'gallery');
  const setView = (name: string) => {
    const v = V[name] ?? V.gallery;
    view = name;
    camera.position.copy(v[0]);
    camera.lookAt(v[1]);
    camera.updateMatrixWorld();
  };
  setView(view);

  const A = arm.userData as { cycle: ArmCycle; setTime(t: number): void; setFailHold(s: number): void; cueTimes(): Record<string, number>; onCue(cb: (c: string) => void): void };
  const cueLog: string[] = [];
  A.onCue((c) => cueLog.push(`${c}@${A.cycle.t.toFixed(2)}`));
  const tParam = q.get('t');
  let run = q.get('run') === '1' || tParam === null;
  if (q.get('park') === '1') L.setMachine('theatre_arm', 'off');
  let time = 0;
  const update = (dt: number) => { time += dt; L.updateTasks(dt); for (const u of L.updaters) u(dt, time); };
  if (tParam !== null) { A.setTime(Number(tParam)); update(0); }
  if (q.get('park') === '1') for (let i = 0; i < 200; i++) update(1 / 50);

  await ctx.render.prepare([new THREE.Vector3(0, 2, -53), new THREE.Vector3(0, 6.2, -45), new THREE.Vector3(23, 1.6, -52)]);
  (window as any).__sp = {
    setTime(t: number) { A.setTime(t); update(0); run = false; },
    view: setView, arm, cycle: () => ({ ...A.cycle }), cues: () => A.cueTimes(), strand, render: () => ctx.render.render(0),
    stats: () => { const r = ctx.renderer.info.render; return { calls: r.calls, tris: r.triangles }; },
  };

  let last = performance.now(), acc = 0, frames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = Math.min((now - last) / 1000, 0.1); last = now;
    acc += raw; frames++;
    if (acc > 0.5) { debug.fps = Math.round(frames / acc); acc = 0; frames = 0; }
    update(run ? raw : 0);
    ctx.render.render(raw);
    const c = A.cycle, r = ctx.renderer.info.render;
    hud.textContent = `W9a set pieces — view ${view}  ${run ? 'running' : 'paused'}  fps ${debug.fps}  calls ${r.calls}  tris ${r.triangles}\n` +
      `arm: t ${c.t.toFixed(2)} / ${c.period.toFixed(1)}  cue ${c.cue}  led ${c.led}  attempt ${c.attempt.toLocaleString('en-GB')}  n ${c.n}\n` +
      `cues ${Object.entries(A.cueTimes()).map(([k, v]) => `${k} ${(+v).toFixed(1)}`).join(' · ')}\n${cueLog.slice(-6).join('  ')}`;
  };
  ctx.render.render(0);
  ctx.ready = true;
  requestAnimationFrame((t) => { last = t; frame(t); });
}
const PI2 = Math.PI / 2;

main().catch((e) => { console.error(e); (window as any).__game = { ready: true, debug: { fps: 0 } }; });
