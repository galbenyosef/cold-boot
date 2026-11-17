/**
 * Isolated enemy harness (dev only): /dev/enemies.html
 *   ?type=husk|skitter|sentry  &pose=slumped|standing|rack|ceiling|none  &n=1
 *   &state=dormant|idle|walk|run|chase|attack|wake|dead|hit|bind|key:<pose>|emerge
 *   &cam=front|side|back|q|close|top|high  &dist=3 &h=1.1 &follow=1
 *   &light=studio|dark  &real=1 (use the real render/materials/fx modules instead of harness stand-ins)
 *   &t=<seconds to pre-simulate> &slow=<time scale> &dmg=part
 * Revision 2:
 *   &idle=watch|work|twitch   dormant behaviour for the spawned machine(s)      &group=<id> (e.g. g_junction)
 *   &pwalk=x0,z0,x1,z1,sec    scripted player walking back and forth between two points (faces travel direction)
 *   &pface=1                  …but always facing the machine (stare)          &pnear=<s> (state=dormant: approach)
 *   &actor=1 [&pose=..] &to=x,y,z [&speed=] [&at=<s>] [&apose=name&aposeat=<s>] [&alook=x,y,z] [&eyes=0|1]
 *   &look2=holo_ghost|holo_tech  (REVISION 5) the actor as a hologram, e.g. &actor=1&pose=tread&look2=holo_tech
 * Revision 4:
 *   &type=human|foreman   &speak=<s> (actor speaks from t=0.3)  &gait=limp|carry|carry_l|carry_r
 *   &scene=booth          glass pane GLASS_Z in front of the actor, warm light behind it, dim foreground
 *   &shelf=1              a 1.0 m shelf in front of the machine (fold workers)
 *   &flashlit=1           scripted player keeps a flashlight on the machine's head
 *   &fire=<s>             scripted player fires a weapon at time s (weapon:fired event)
 * Stage 3a §8.8 (Halvorsen):
 *   &who=halvorsen        the human actor is Halvorsen (loads his head; level stays 2 unless &level=3)
 *   &both=1               Tomas (left, x −0.75) and Halvorsen (right, x +0.75) side by side, same pose
 *   &office=1             desk (front edge 0.32 m ahead, top 0.76), chair under him, swivel monitor, phone base;
 *                         the props are handed to him (monitor, phone, badge target)
 *   &light=lamp           warm desk-lamp key from his front-left + a dim cold fill (no studio env)
 *   &props=glasses:nose,mug:1,expr:fear   prop(name, value) calls at t = 0
 *   &seq=pose@t,pose@t    pose changes at times (also one-shots: rub_face, flinch)
 *   &pinobj=1             a small marker circling in front of him; he is pinned to it (lookAt(Object3D))
 *   &lookcam=1            he is pinned to the camera (lookAt(camera)); &camorbit=<rad/s> swings the camera round him
 *   &nohead=1             his procedural fallback head (as if the GLB failed to load)
 *   &colltest=1           logs where a player-sized capsule walking into him stops, and what a chest ray hits
 * Stage 3b §8.4:
 *   &skin=lab|navy|all    EnemySpawn.skin of the spawned husk / sentry; `all` cycles none, lab, navy over &n
 *   &light=cold           clean-room light: cold white overhead panels (no warm key); &light=dark is the flashlight
 *   &light=black          all lights off, no environment (dark-room marks); &flash=1 adds the flashlight   &quality=low|medium|high
 *   &pstay=1              (state=dormant/idle) the scripted player stays at &ppos instead of 40 m away
 *   &hood=1               a fume hood in front of the machine (surface 0.9 m, sash opening to 1.3 m) — &pose=bench
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { EnemyType, FxSystem, GameContext, LightDesc, LightHandle, LightManager, MaterialLibrary, MaterialName } from '../../core/types';
import { createEvents } from '../../core/events';
import { clampBuilt, parseLevel } from '../../core/progress';
import { createPhysics } from '../../physics/physics';
import { createEnemies } from '../index';

const q = new URLSearchParams(location.search);
const P = (k: string, d: string) => q.get(k) ?? d;
const type = P('type', 'husk') as EnemyType;
const state = P('state', 'idle');
const pose = P('pose', 'none');
const cam = P('cam', 'q');
const lightMode = P('light', 'studio');
const count = Number(P('n', '1'));
const slow = Number(P('slow', '1'));

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const events = createEvents();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(P('fov', '40')), innerWidth / innerHeight, 0.02, 200);
  const debug = { autostart: true, spawn: null, noEnemies: false, noStory: true, god: false, giveAll: false, quality: (q.get('quality') as any) ?? null, verbose: true, fps: 0 };
  const ctx = {
    canvas, uiRoot: document.getElementById('ui')!, scene, camera, events, physics: createPhysics(), debug, time: 0, state: 'playing', ready: false, levelId: clampBuilt(parseLevel(P('level', '2')) ?? 2), facts: {},
    setState() {},
  } as unknown as GameContext;
  (window as any).__game = ctx;
  scene.add(camera);
  const who = q.get('who') ?? undefined;
  const both = q.get('both') === '1';
  if (who === 'halvorsen' || both) (ctx as any).devCast = { halvorsen: true, noHead: q.get('nohead') === '1' };

  let real = q.get('real') === '1';
  if (real) {
    try {
      const { createRender } = await import('../../render');
      const { createMaterials } = await import('../../materials');
      const { createFx } = await import('../../fx');
      ctx.render = await createRender(ctx);
      ctx.materials = await createMaterials(ctx);
      ctx.fx = await createFx(ctx);
    } catch (e) { console.warn('[harness] real modules failed, using stand-ins', e); real = false; }
  }
  if (!real) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // r187: PCFSoftShadowMap was removed (PCF is soft now)
    ctx.renderer = renderer;
    ctx.render = fakeRender(ctx) as any;
    ctx.materials = fakeMaterials();
    ctx.fx = fakeFx(ctx);
  }
  const renderer = ctx.renderer;
  const audioLog: string[] = [];
  ctx.audio = {
    unlock: async () => {}, play(id: string) { audioLog.push('play:' + id); }, setMusic() {}, setRoom() {}, choirVoice() {}, setMasterVolume() {}, setMuffle() {}, update() {},
    say(id: string) { audioLog.push('say:' + id); return { duration: 2, done: Promise.resolve(), setPosition() {}, stop() {} }; }, preloadVoice: async () => {},
    loop(id: string) { audioLog.push('loop+' + id); return { setVolume() {}, setPosition() {}, stop() { audioLog.push('loop-' + id); } }; },
  } as any;

  // ── environment
  if (!real || lightMode === 'studio' || lightMode === 'lamp' || lightMode === 'cold') {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = lightMode === 'dark' ? 0.04 : lightMode === 'lamp' ? 0.06 : lightMode === 'cold' ? 0.3 : 0.45;
  }
  scene.background = new THREE.Color(lightMode === 'black' ? 0x000000 : lightMode === 'dark' || lightMode === 'lamp' ? 0x030405 : 0x0b0d10);
  const floorMat = ctx.materials.get('floor_concrete');
  const wallMat = ctx.materials.get('wall_panel');
  const colliders: THREE.Mesh[] = [];
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = true;
    scene.add(mesh); colliders.push(mesh);
    return mesh;
  };
  addBox(60, 0.4, 60, 0, -0.2, 0, floorMat);
  addBox(60, 8, 0.4, 0, 4, -3.2, wallMat);            // back wall (z = -3)
  addBox(60, 0.4, 60, 0, P('ceil', q.get('room') === '1' ? '3.2' : '6') === '0' ? 40 : Number(P('ceil', q.get('room') === '1' ? '3.2' : '6')) + 0.2, 0, wallMat);
  if (q.get('room') === '1') {
    // closed box room for surface-crawling tests: side walls at x = ±4, ceiling 3.2, a ceiling vent at (vx, vz)
    addBox(0.4, 8, 60, -4.2, 4, 0, wallMat); addBox(0.4, 8, 60, 4.2, 4, 0, wallMat);
    const vx = Number(P('vx', '0')), vz = Number(P('vz', '0'));
    if (q.get('vent') === '1') addBox(0.9, 0.4, 0.9, vx, 3.0, vz, wallMat);
  }
  if (q.get('hood') === '1') {
    // stage 3b fume hood (pose=bench, yaw=0: the machine faces −z): work surface 0.9 m from 0.55 m ahead, 0.8 deep,
    // sash glass from 1.3 m up, side walls, a roof; the sash plane 0.55 m ahead of the machine's feet
    const hx = Number(P('x', '0')), hz = Number(P('z', '0')) - 0.55;
    addBox(1.5, 0.9, 0.8, hx, 0.45, hz - 0.4, wallMat);
    addBox(0.06, 1.6, 0.8, hx - 0.75, 1.7, hz - 0.4, wallMat); addBox(0.06, 1.6, 0.8, hx + 0.75, 1.7, hz - 0.4, wallMat);
    addBox(1.56, 0.06, 0.8, hx, 2.5, hz - 0.4, wallMat); addBox(1.5, 1.6, 0.06, hx, 1.7, hz - 0.8, wallMat);
    const gm = ctx.materials.get('glass').clone(); gm.transparent = true; gm.depthWrite = false;
    const sash = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.95), gm); sash.position.set(hx, 1.3 + 0.475, hz); scene.add(sash);
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), ctx.materials.get('plastic_white')); rack.position.set(hx - 0.15, 0.93, hz - 0.02); scene.add(rack);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.015, 0.09), ctx.materials.get('plastic_white')); plate.position.set(hx + 0.04, 0.908, hz - 0.08); scene.add(plate);
  }
  if (q.get('shelf') === '1') addBox(1.4, 1.0, 0.4, Number(P('x', '0')), 0.5, Number(P('z', '0')) + 0.62, wallMat);
  if (q.get('scene') === '1' || q.get('scene') === 'booth') {
    // the booth: a pane of thick glass in front of him, warm light inside, the viewer in the dim hall
    const gz = Number(P('z', '0')) + 0.42;
    const gm = (ctx.materials.get('glass_thick' as MaterialName).name === 'glass_thick' ? ctx.materials.get('glass_thick' as MaterialName) : ctx.materials.get('glass')).clone();
    gm.transparent = true; gm.opacity = Math.min(gm.opacity ?? 1, 0.35); gm.depthWrite = false;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), gm);
    pane.position.set(0, 1.3, gz); scene.add(pane);
    addBox(4, 0.9, 0.3, 0, 0.45, gz + 0.15, wallMat); // console sill under the glass
  }
  if (q.get('office') === '1') {
    // Halvorsen's office (§4.3, distances from his seat): desk front edge 0.32 m ahead, top 0.76, 1.2 deep; chair under him
    const ox = Number(P('x', '0')), oz = Number(P('z', '0'));
    const wood = ctx.materials.get('wood_veneer' as MaterialName);
    const deskM = wood.name === 'wood_veneer' ? wood : wallMat;
    addBox(1.6, 0.035, 1.2, ox, 0.76 - 0.0175, oz + 0.32 + 0.6, deskM);
    addBox(0.04, 0.72, 1.1, ox - 0.76, 0.36, oz + 0.32 + 0.6, deskM); addBox(0.04, 0.72, 1.1, ox + 0.76, 0.36, oz + 0.32 + 0.6, deskM);
    addBox(1.5, 0.4, 0.02, ox, 0.52, oz + 0.32 + 1.15, deskM); // modesty panel at the back
    const chairM = ctx.materials.get('fabric');
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.44), chairM); seat.position.set(ox, 0.44, oz - 0.02); scene.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.05), chairM); back.position.set(ox, 0.78, oz - 0.27); back.rotation.x = -0.12; scene.add(back);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), ctx.materials.get('chrome')); post.position.set(ox, 0.21, oz - 0.02); scene.add(post);
    // swivel monitor (pivot = its centre), facing him at the start
    const mon = new THREE.Group(); mon.position.set(ox - 0.3, 1.08, oz + 0.32 + 0.55);
    const scr = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), ctx.materials.get('plastic_dark')); mon.add(scr);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), new THREE.MeshBasicMaterial({ color: 0x3a6a8a })); face.position.z = -0.016; face.rotation.y = Math.PI; mon.add(face);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), ctx.materials.get('chrome')); arm.position.y = -0.3; mon.add(arm);
    scene.add(mon); (ctx as any)._monitor = mon;
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.18), ctx.materials.get('plastic_white')); phone.position.set(ox + 0.32, 0.76 + 0.025, oz + 0.32 + 0.18); scene.add(phone);
    (ctx as any)._phoneBase = new THREE.Vector3(ox + 0.32, 0.76 + 0.05, oz + 0.32 + 0.18);
    (ctx as any)._badgeTarget = new THREE.Vector3(ox - 0.05, 0.76, oz + 0.32 + 0.8);
  }
  if (q.get('obst') === '1') { addBox(1.2, 1.2, 1.2, 2.5, 0.6, 4, wallMat); addBox(4, 2.5, 0.4, -3, 1.25, 6, wallMat); addBox(0.6, 0.25, 3, 0, 0.125, 5, wallMat); }
  ctx.physics.build(colliders);

  const lights = ctx.render.lights;
  if (lightMode === 'lamp') {
    // Halvorsen's office: a banker's-lamp key from his front-left, a dim cold fill, a faint bounce off the desk
    const ox = Number(P('x', '0')), oz = Number(P('z', '0'));
    lights.add({ type: 'spot', position: new THREE.Vector3(ox + 0.55, 1.75, oz + 0.85), target: new THREE.Vector3(ox, 1.25, oz), color: 0xffc58a, intensity: Number(P('lampI', '14')), distance: 6, angle: 0.75, penumbra: 0.7, castShadow: true });
    lights.add({ type: 'point', position: new THREE.Vector3(ox - 2.0, 2.4, oz + 2.5), color: 0x6c86a8, intensity: Number(P('fillI', '1.6')), distance: 9 });
    lights.add({ type: 'point', position: new THREE.Vector3(ox + 0.1, 0.95, oz + 0.7), color: 0xffb070, intensity: 0.35, distance: 2.0 });
  } else if (q.get('scene') === 'booth') {
    const z0 = Number(P('z', '0'));
    lights.add({ type: 'point', position: new THREE.Vector3(-0.5, 2.7, z0 - 0.6), color: 0xffb46a, intensity: 10, distance: 7, castShadow: true });
    lights.add({ type: 'spot', position: new THREE.Vector3(0.5, 2.8, z0 + 0.3), target: new THREE.Vector3(0, 1.2, z0), color: 0xffc890, intensity: 45, distance: 8, angle: 0.8, penumbra: 0.8, castShadow: true });
    lights.add({ type: 'point', position: new THREE.Vector3(0, 0.8, z0 + 0.25), color: 0x6fb0ff, intensity: 0.25, distance: 1.5 }); // console glow
    lights.add({ type: 'point', position: new THREE.Vector3(3, 3, z0 + 6), color: 0x4a5a70, intensity: 3, distance: 14 });  // hall
  } else if (lightMode === 'cold') {
    // clean room: two cold white ceiling panels, a soft fill — the light of Bio-Sys
    lights.add({ type: 'spot', position: new THREE.Vector3(0.8, 3.4, 1.6), target: new THREE.Vector3(0, 0.8, 0), color: 0xeef4ff, intensity: 160, distance: 14, angle: 1.0, penumbra: 0.9, castShadow: true });
    lights.add({ type: 'point', position: new THREE.Vector3(-2.0, 3.2, 3.5), color: 0xdde8f5, intensity: 30, distance: 12 });
    lights.add({ type: 'point', position: new THREE.Vector3(2.5, 3.0, -1.5), color: 0xe6eefa, intensity: 14, distance: 10 });
  } else if (lightMode === 'black') {
    // all lights off (dark-room marks): nothing but the machines' own glow, and the flashlight with &flash=1
  } else if (lightMode === 'studio') {
    lights.add({ type: 'spot', position: new THREE.Vector3(3.5, 5, 5.5), target: new THREE.Vector3(0, 0.9, 0), color: 0xfff1e0, intensity: 520, distance: 30, angle: 0.5, penumbra: 0.6, castShadow: true });
    lights.add({ type: 'point', position: new THREE.Vector3(-4, 2.5, 1), color: 0x7fb0ff, intensity: 40, distance: 20 });
    lights.add({ type: 'point', position: new THREE.Vector3(0, 3, -2.2), color: 0xffffff, intensity: 30, distance: 12 });
  } else {
    lights.add({ type: 'spot', position: new THREE.Vector3(0.6, 3.6, 3), target: new THREE.Vector3(0, 0.8, 0.5), color: 0xffb070, intensity: 260, distance: 16, angle: 0.55, penumbra: 0.8, castShadow: true });
    lights.add({ type: 'point', position: new THREE.Vector3(-3, 1.5, -2), color: 0x4a7a90, intensity: 6, distance: 12 });
  }

  if (q.get('room') === '1') {
    lights.add({ type: 'point', position: new THREE.Vector3(0, 2.7, 4), color: 0xffe8d0, intensity: 40, distance: 18 });
    lights.add({ type: 'spot', position: new THREE.Vector3(2.5, 3.0, 11), target: new THREE.Vector3(-3, 1, 5), color: 0xfff1e0, intensity: 160, distance: 22, angle: 0.7, penumbra: 0.6, castShadow: true });
  }
  // ── fake level + player
  const spawnPos = new THREE.Vector3(Number(P('x', '0')), pose === 'rack' ? 3.2 : pose === 'ceiling' ? 0 : Number(P('y', '0')), pose === 'slumped' ? -2.62 : Number(P('z', '0')));
  const dormant = pose !== 'none' || state === 'dormant';
  const enemySpawns: any[] = [];
  const skinParam = q.get('skin');
  const yaw0 = Number(P('yaw', '180')) * Math.PI / 180; // default: face +Z (toward the default camera)
  const isActor = q.get('actor') === '1';
  if (state !== 'bind' && !state.startsWith('key:') && !isActor) {
    for (let i = 0; i < count; i++) {
      enemySpawns.push({
        id: 'h' + i, type, position: spawnPos.clone().add(new THREE.Vector3((i - (count - 1) / 2) * 1.3, 0, 0)), yaw: yaw0, group: P('group', 'g'),
        mode: state === 'emerge' ? 'spawn' : dormant ? 'dormant' : 'spawn', pose: pose === 'none' ? undefined : pose, idle: q.get('idle') ?? undefined,
        skin: skinParam === 'all' ? [undefined, 'lab', 'navy'][i % 3] : skinParam ?? undefined,
      });
    }
  }
  ctx.level = { root: new THREE.Group(), nav: [], doors: [], enemySpawns, rooms: [], colliders, roomAt: () => null, update() {} } as any;
  for (const sp of enemySpawns) sp.group = P('group', 'g');
  const player = {
    position: new THREE.Vector3(0, 0, 9), eye: new THREE.Vector3(0, 1.65, 9), velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    alive: true, health: 100, maxHealth: 100, flashlightOn: false, shake() {}, setCarry() {},
    damage(n: number) { player.health -= n; console.log('[harness] player damaged', n, '→', player.health); },
  };
  ctx.player = player as any;
  if (q.get('ppos')) { const n = q.get('ppos')!.split(',').map(Number); player.position.set(n[0], n[1], n[2]); }

  const t0 = performance.now();
  const enemies = await createEnemies(ctx);
  ctx.enemies = enemies;
  if (q.get('lod')) (enemies as any).world.forceLod = Number(q.get('lod'));
  const tuneSkitters = () => { for (const e of enemies.all as any[]) if (e.type === 'skitter') { if (q.get('climb')) e.climbChance = Number(q.get('climb')); if (q.get('ceilp')) e.ceilingChance = Number(q.get('ceilp')); } };
  const buildMs = performance.now() - t0;
  const templates = (enemies as any).templates;
  const info: string[] = [`build ${buildMs.toFixed(0)} ms`];
  for (const k of Object.keys(templates ?? {})) info.push(`${k}: ${templates[k].rig.triangles} tris, ${templates[k].rig.drawCalls} draws, ${templates[k].rig.bones.length} bones`);
  console.log('[harness] ' + info.join(' | '));

  let focusObj: THREE.Object3D | null = null;
  if (state === 'bind' || state.startsWith('key:')) {
    const tpl = templates[type];
    const rig = tpl.rig.instantiate();
    scene.add(rig.root);
    focusObj = rig.root;
    if (state.startsWith('key:') && type === 'husk') {
      const { applySpec, HUSK_POSES } = await import('../husk/poses');
      applySpec(rig, HUSK_POSES[state.slice(4)]);
    }
  } else if (state === 'emerge') {
    enemies.spawnGroup(P('group', 'g'));
  } else if (state === 'idle') {
    if (skinParam) enemies.spawnGroup('g'); // spawn() has no skin: go through the level spawn list
    else for (const sp of enemySpawns) enemies.spawn(sp.type, sp.position, sp.yaw, 'g');
  } else if (!dormant) {
    enemies.spawnGroup(P('group', 'g'));
  }
  let actor: import('../../core/types').EnemyActor | null = null;
  const v3 = (k: string) => { const a = q.get(k)!.split(',').map(Number); return new THREE.Vector3(a[0], a[1], a[2]); };
  let actorArrived = -1;
  if (isActor) {
    const aopts: any = {};
    if (q.get('look2')) aopts.look = q.get('look2');
    if (who && !both) aopts.who = who;
    if (both) {
      const tomas = enemies.actor(type, spawnPos.clone().add(new THREE.Vector3(-0.75, 0, 0)), yaw0, pose === 'none' ? undefined : pose, {});
      (window as any).__tomas = tomas;
      aopts.who = 'halvorsen';
      actor = enemies.actor(type, spawnPos.clone().add(new THREE.Vector3(0.75, 0, 0)), yaw0, pose === 'none' ? undefined : pose, aopts);
    } else actor = enemies.actor(type, spawnPos, yaw0, pose === 'none' ? undefined : pose, Object.keys(aopts).length ? aopts : undefined);
    (window as any).__actor = actor;
    const prop = (actor as any).prop as ((n: string, v: unknown) => void) | undefined;
    if (prop) {
      if ((ctx as any)._monitor) prop('monitor', (ctx as any)._monitor);
      if ((ctx as any)._phoneBase) prop('phone', (ctx as any)._phoneBase);
      if ((ctx as any)._badgeTarget) prop('badgeTarget', (ctx as any)._badgeTarget);
      for (const kv of (q.get('props') ?? '').split(',').filter(Boolean)) {
        const [k, v] = kv.split(':');
        prop(k, v === '1' ? true : v === '0' ? false : v);
      }
    }
    if (q.get('lookcam') === '1') actor.lookAt(camera);
    if (q.get('pinobj') === '1') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff4020 }));
      scene.add(m); (ctx as any)._pinObj = m;
      actor.lookAt(m);
    }
    if (q.get('eyes')) actor.setEyes(q.get('eyes') === '1');
    if (q.get('alook')) actor.lookAt(v3('alook'));
    if (q.get('gait')) actor.setGait?.(q.get('gait')!);
  }
  const first = () => (actor ? { position: actor.position, object: actor.object, state: 'actor', health: 0, yaw: 0 } as any : enemies.all[0]);
  tuneSkitters();

  // scripted player per state
  const events_: string[] = [];
  for (const ev of ['enemy:woke', 'enemy:alerted', 'enemy:attack', 'enemy:died', 'enemy:group-cleared', 'enemy:spawned'] as const) {
    events.on(ev, () => { events_.push(ev.slice(6)); });
  }
  let steps = 0;
  events.on('enemy:step', () => { steps++; });
  let time = 0;
  let woke = false, killed = false, hitT = 0, nHits = 0, severed = false;
  const maxHits = Number(P('hits', '999'));
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const sim = (dt: number) => {
    time += dt; ctx.time = time;
    const e = first();
    const ep = e ? e.position : spawnPos;
    if (q.get('pwalk')) {
      const a = q.get('pwalk')!.split(',').map(Number), T = a[4] || 8;
      const ph = (time % (2 * T)) / T, k = ph < 1 ? ph : 2 - ph, sm = k * k * (3 - 2 * k);
      player.position.set(a[0] + (a[2] - a[0]) * sm, 0, a[1] + (a[3] - a[1]) * sm);
      const dir = ph < 1 ? 1 : -1;
      player.forward.set((a[2] - a[0]) * dir, 0, (a[3] - a[1]) * dir).normalize();
      if (q.get('pface') === '1') player.forward.copy(ep).setY(ep.y + 0.9).sub(player.eye).normalize();
    } else if (q.get('pnear')) {
      // approach to 4 m at pnear seconds, back off to 12 m at 2*pnear
      const t1 = Number(q.get('pnear'));
      const r = time < t1 ? 12 : time < 2 * t1 ? 4 : 12;
      player.position.set(ep.x, 0, ep.z + r);
    } else if ((state === 'idle' || state === 'dormant') && q.get('pstay') !== '1') { player.position.set(0, 0, -40); }
    else if (state === 'walk') {
      // keep far ahead so it walks; circle slowly
      const a = time * 0.12;
      player.position.set(Math.sin(a) * 30, 0, Math.cos(a) * 30 + 0);
    } else if (state === 'run') {
      const a = time * 0.5;
      player.position.set(ep.x + Math.sin(a) * 5, 0, ep.z + Math.cos(a) * 5);
    } else if (state === 'attack') {
      player.position.set(spawnPos.x, 0, spawnPos.z + 1.25);
    } else if (state === 'chase' || state === 'emerge') {
      if (!q.get('ppos')) player.position.set(3, 0, 8);
    } else if (state === 'wake' || state === 'dead' || state === 'hit') {
      if (!q.get('ppos')) player.position.set(1.5, 0, 9);
    }
    player.eye.copy(player.position).setY(player.position.y + 1.65);
    if (state === 'wake' && !woke && time > Number(P('wakeat', '0.5'))) { woke = true; enemies.wakeGroup(P('group', 'g'), 0.6); }
    if ((state === 'dead' || state === 'hit') && e && e.alive && nHits < maxHits) {
      hitT -= dt;
      if (time > Number(P('hitat', '0.6')) && hitT <= 0) {
        nHits++;
        hitT = Number(P('hitgap', state === 'dead' ? '0.25' : '1.0'));
        const part = P('dmg', 'torso');
        const tgt = tmp.copy(e.position); tgt.y += part === 'head' ? 1.68 : part === 'arm' ? 1.25 : part === 'leg' ? 0.5 : 1.3;
        if (part === 'arm') tgt.x += 0.215 * (Math.cos((e as any).yaw + Math.PI));
        if (part === 'leg') { tgt.x += 0.1 * (Math.cos((e as any).yaw + Math.PI)); tgt.z -= 0.1 * Math.sin((e as any).yaw + Math.PI); }
        if (part === 'armr') { tgt.y = e.position.y + 1.25; tgt.x -= 0.215 * (Math.cos((e as any).yaw + Math.PI)); }
        if (type === 'skitter') tgt.y = e.position.y + 0.22;
        if (type === 'sentry') tgt.y = e.position.y;
        const origin = new THREE.Vector3(player.eye.x, tgt.y, player.eye.z);
        const dir = tgt.clone().sub(origin).normalize();
        const hit = enemies.hitscan(origin, dir, 60);
        if (hit) enemies.damage(hit, Number(P('amt', '20')), dir);
        else console.log('[harness] hitscan missed');
        void killed;
      }
    }
    if (q.get('sever') && !severed && time > Number(q.get('sever')) && e) {
      severed = true;
      const d = new THREE.Vector3(1, 0, 0);
      (e as any).severArm(0, d); (e as any).severArm(1, d);
    }
    if (['walk', 'run', 'attack', 'chase'].includes(state) && time < 0.1) enemies.alertNoise(spawnPos, 100);
    if (actor && q.get('to') && actorArrived === -1 && time >= Number(P('at', '0.2'))) {
      actorArrived = -2;
      actor.moveTo(v3('to'), q.get('speed') ? Number(q.get('speed')) : undefined).then(() => { actorArrived = time; console.log('[harness] actor arrived at t=' + time.toFixed(2)); });
    }
    if (actor && q.get('speak') && (actor as any)._spoke !== true && time > 0.3) { (actor as any)._spoke = true; actor.speak?.(Number(q.get('speak'))); }
    if (q.get('flashlit') === '1' && e) { (player as any).flashlightOn = true; player.forward.copy(e.position).setY(e.position.y + 1.68).sub(player.eye).normalize(); }
    if (q.get('fire') && (ctx as any)._fired !== true && time > Number(q.get('fire'))) { (ctx as any)._fired = true; events.emit('weapon:fired', { weapon: 'pistol', origin: player.eye.clone(), direction: player.forward.clone() }); }
    if (actor && q.get('apose') && time >= Number(P('aposeat', '1')) && (actor as any)._posed !== true) { (actor as any)._posed = true; actor.setPose(q.get('apose')!); }
    if (actor && q.get('seq')) {
      const done: Set<number> = ((actor as any)._seqDone ??= new Set<number>());
      q.get('seq')!.split(',').forEach((it, i) => {
        const [ps, at] = it.split('@');
        if (!done.has(i) && time >= Number(at)) { done.add(i); actor!.setPose(ps); }
      });
    }
    const pin = (ctx as any)._pinObj as THREE.Object3D | undefined;
    if (pin) {
      const a = time * 0.9;
      pin.position.set(spawnPos.x + Math.sin(a) * 0.55, spawnPos.y + 1.5 + Math.sin(a * 1.7) * 0.2, spawnPos.z + 0.9 + Math.cos(a) * 0.2);
    }
    enemies.update(dt);
    ctx.fx.update(dt);
  };

  // pre-simulate
  const pre = Number(P('t', '0'));
  for (let t = 0; t < pre; t += 1 / 60) sim(1 / 60);

  const dist = Number(P('dist', type === 'husk' ? '3.2' : '2'));
  const hh = Number(P('h', type === 'husk' ? '1.0' : '0.3'));
  const follow = P('follow', '1') === '1';
  const camTarget = new THREE.Vector3();
  const placeCamera = () => {
    const e = first();
    const base = focusObj ? focusObj.position : e ? e.object.position : spawnPos;
    if (follow || camTarget.lengthSq() === 0) camTarget.set(base.x, base.y + hh, base.z);
    const o = tmp;
    switch (cam) {
      case 'front': o.set(0, 0.15, 1); break;
      case 'side': o.set(1, 0.1, 0); break;
      case 'back': o.set(0, 0.2, -1); break;
      case 'close': o.set(0.25, 0.05, 1); break;
      case 'top': o.set(0.01, 1, 0.2); break;
      case 'high': o.set(0.7, 0.9, 1); break;
      case 'low': o.set(0.5, -0.12, 1); break;
      case 'q2': o.set(-0.8, 0.3, 1); break;
      case 'bq': o.set(-0.7, 0.3, -1); break;
      default: o.set(0.75, 0.32, 1);
    }
    if (q.get('camorbit')) o.applyAxisAngle(up, Math.sin(time * Number(q.get('camorbit'))) * 0.9);
    o.normalize().multiplyScalar(dist);
    camera.position.copy(camTarget).add(o);
    if (q.get('campos')) { const a = q.get('campos')!.split(',').map(Number); camera.position.set(a[0], a[1], a[2]); }
    if (q.get('look')) { const a = q.get('look')!.split(',').map(Number); camTarget.set(a[0], a[1], a[2]); }
    camera.lookAt(camTarget);
    if ((lightMode === 'dark' || lightMode === 'black') && flash) {
      flash.position.copy(camera.position); flash.target.copy(camTarget);
    }
    void up;
  };
  let flash: LightHandle | null = null;
  if ((lightMode === 'dark' && q.get('flash') !== '0') || (lightMode === 'black' && q.get('flash') === '1')) {
    flash = lights.add({ type: 'spot', position: new THREE.Vector3(), target: new THREE.Vector3(), color: 0xdfe8ff, intensity: 60, distance: 20, angle: 0.3, penumbra: 0.5, castShadow: true });
  }

  let last = performance.now(), acc = 0, frames = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(raw, 1 / 20) * slow;
    acc += raw; frames++;
    if (acc > 0.5) { debug.fps = Math.round(frames / acc); acc = 0; frames = 0; }
    sim(dt);
    placeCamera();
    ctx.render.render(dt);
    const e = first() as any;
    hud.textContent = `${type} state=${state} pose=${pose} t=${time.toFixed(2)} fps=${debug.fps}\n` +
      (e ? `enemy: ${e.state}/${e.mode ?? ''} hp=${e.health.toFixed(0)} dist=${e.dist?.toFixed(1)} active=${enemies.activeCount} watch=${((e.watchYaw ?? 0) * 57.3).toFixed(1)} work=${e.workFrozen ? 'FROZEN' : (e.workT ?? 0).toFixed(2)}\n` : '') +
      `player hp=${player.health} steps=${steps}\nevents: ${events_.slice(-8).join(' ')}\n${audioLog.slice(-4).join(' ')}\n${info.join('\n')}`;
  };
  if (q.get('colltest') === '1' && actor) {
    // §8.8 collider check: a player-sized capsule walks into him from the front for 2.5 s; where does it stop?
    const body = { position: new THREE.Vector3(spawnPos.x + 0.05, spawnPos.y, spawnPos.z + 1.6), velocity: new THREE.Vector3(), radius: 0.32, height: 1.75, onGround: true, gravityScale: 1 };
    for (let i = 0; i < 150; i++) { body.velocity.x = 0; body.velocity.z = -2.0; sim(1 / 60); ctx.physics.moveBody(body as any, 1 / 60); }
    console.log('[harness] colltest: capsule stopped at z=' + body.position.z.toFixed(3) + ' (actor at z=' + actor.position.z.toFixed(3) + ', distance ' + (body.position.z - actor.position.z).toFixed(3) + ')');
    // a shot at his chest from the front: what does the ray hit?
    const hit = ctx.physics.raycast(new THREE.Vector3(spawnPos.x, spawnPos.y + 1.2, spawnPos.z + 3), new THREE.Vector3(0, 0, -1), 10);
    console.log('[harness] colltest: chest ray hits ' + (hit ? hit.surface + ' at z=' + hit.point.z.toFixed(3) + ' owner=' + String(hit.owner) : 'nothing'));
  }
  const strip = Number(P('strip', '0'));
  if (strip > 1) {
    // contact sheet: N time slices side by side (for judging animation from one screenshot)
    const interval = Number(P('si', '0.12'));
    const cols = Math.min(strip, Number(P('cols', String(strip)))), rows = Math.ceil(strip / cols);
    const w = Math.floor(innerWidth / cols), h = Math.floor(innerHeight / rows);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.autoClear = true;
    for (let i = 0; i < strip; i++) {
      const cx = (i % cols) * w, cy = innerHeight - h - Math.floor(i / cols) * h;
      renderer.setViewport(cx, cy, w, h); renderer.setScissor(cx, cy, w, h);
      placeCamera();
      ctx.render.render(0);
      for (let k = 0; k < Math.round(interval * 120); k++) sim(1 / 120);
    }
    const e = first() as any;
    const dbgE = (enemies as any).actors?.find((x: any) => x.who === 'halvorsen');
    if (dbgE) { const v = new THREE.Vector3(); dbgE.B.card.getWorldPosition(v); const hv = new THREE.Vector3(); dbgE.B.hand_r.getWorldPosition(hv); console.log('[harness] halvorsen', JSON.stringify(dbgE.props), 'hand', hv.toArray().map((n: number) => n.toFixed(3)).join(','), 'card', v.toArray().map((n: number) => n.toFixed(3)).join(','), 'scale', dbgE.B.card.scale.x.toFixed(3)); }
    hud.textContent = `${type} ${state} strip ${strip} × ${interval}s  t=${time.toFixed(2)} ${e ? e.state + '/' + (e.mode ?? '') + ' hp=' + e.health.toFixed(0) : ''} ${actor ? 'actor arrived=' + actorArrived.toFixed(2) : ''} player hp=${player.health} steps=${steps}\nevents: ${events_.join(' ')}\nfx: ${JSON.stringify((ctx.fx as any).counts ?? {})} ${audioLog.join(' ')}`;
    ctx.ready = true;
    return;
  }
  placeCamera();
  ctx.render.render(0);
  ctx.ready = true;
  requestAnimationFrame((t) => { last = t; frame(t); });
}

function fakeRender(ctx: GameContext) {
  const handles: any[] = [];
  let shadowed = 0;
  const lights: LightManager = {
    add(desc: LightDesc): LightHandle {
      const light = desc.type === 'spot'
        ? new THREE.SpotLight(desc.color, desc.intensity, desc.distance, desc.angle ?? 0.6, desc.penumbra ?? 0.5)
        : new THREE.PointLight(desc.color, desc.intensity, desc.distance);
      light.position.copy(desc.position);
      const target = desc.target ? desc.target.clone() : new THREE.Vector3();
      if (light instanceof THREE.SpotLight) {
        ctx.scene.add(light.target);
        if (desc.castShadow && shadowed < 3) {
          shadowed++;
          light.castShadow = true; light.shadow.mapSize.set(2048, 2048); light.shadow.bias = -0.0004; light.shadow.normalBias = 0.01;
          light.shadow.camera.near = 0.2; light.shadow.camera.far = desc.distance;
        }
      }
      ctx.scene.add(light);
      const h: any = {
        desc, light, enabled: desc.enabled !== false, intensityScale: 1,
        get factor() { return h.enabled ? h.intensityScale : 0; },
        position: light.position, target,
        setFlicker() {}, setColor(c: THREE.ColorRepresentation) { light.color.set(c); }, bindEmissive() {},
        remove() { ctx.scene.remove(light); const i = handles.indexOf(h); if (i >= 0) handles.splice(i, 1); },
      };
      handles.push(h);
      return h;
    },
    setGroup() {}, group: () => [],
  };
  return {
    lights, post: { damage() {}, glitch() {}, fade() {}, setLowHealth() {}, setExposure() {} }, viewmodelLayer: 1, quality: 'high',
    setQuality() {}, async prepare() {},
    render() {
      for (const h of handles) {
        h.light.intensity = h.desc.intensity * h.factor;
        if (h.light.isSpotLight) h.light.target.position.copy(h.target);
      }
      ctx.renderer.render(ctx.scene, ctx.camera);
    },
    resize() {},
    _handles: handles,
  };
}

function noiseTex(seed: number, scale = 1, contrast = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  let s = seed;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const grid = new Float32Array(33 * 33); for (let i = 0; i < grid.length; i++) grid[i] = r();
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const gx = (x / 8), gy = (y / 8), xi = Math.floor(gx), yi = Math.floor(gy), fx = gx - xi, fy = gy - yi;
    const a = grid[yi * 33 + xi], b = grid[yi * 33 + xi + 1], cc = grid[(yi + 1) * 33 + xi], d = grid[(yi + 1) * 33 + xi + 1];
    let v = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
    v = v * 0.7 + r() * 0.3;
    v = Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5));
    const k = (y * 256 + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(scale, scale);
  return t;
}

function fakeMaterials(): MaterialLibrary {
  const rough = noiseTex(7, 5, 1.2), rough2 = noiseTex(11, 9, 1.8);
  const shellTex = noiseTex(3, 2.5, 0.12); shellTex.colorSpace = THREE.SRGBColorSpace;
  const defs: Record<string, [number, number, number]> = {
    robot_shell: [0xd9dad3, 0.36, 0.0], robot_frame: [0x1b1d21, 0.5, 0.85], robot_joint: [0x5a5d60, 0.32, 1.0], rubber: [0x0c0c0d, 0.85, 0],
    chrome: [0xd8dce0, 0.08, 1], steel_raw: [0x8a8e93, 0.35, 1], painted_orange: [0xb5521c, 0.5, 0.1], painted_yellow: [0xb8901a, 0.5, 0.1],
    painted_dark: [0x15171a, 0.45, 0.4], gunmetal: [0x24272b, 0.38, 0.9], screen_off: [0x030405, 0.06, 0.2], floor_concrete: [0x4a4845, 0.8, 0], wall_panel: [0x4a534f, 0.6, 0.3],
    plastic_dark: [0x18191b, 0.5, 0], glass: [0x8fa4ab, 0.05, 0], copper: [0xa5633a, 0.3, 1], painted_white: [0xcfd2d0, 0.4, 0.1], plastic_white: [0xd8d8d2, 0.4, 0], trim_steel: [0x6a6e72, 0.4, 0.9],
  };
  const emis: Record<string, number> = { emissive_white: 0xe8f2ff, emissive_warm: 0xffd9a0, emissive_red: 0xff2010, emissive_amber: 0xff9a20, emissive_cyan: 0x30e0ff, emissive_green: 0x40ff70 };
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const get = (name: MaterialName) => {
    let m = cache.get(name);
    if (m) return m;
    if (name in emis) m = new THREE.MeshStandardMaterial({ color: 0, emissive: emis[name], emissiveIntensity: 2.2 });
    else {
      const d = defs[name] ?? [0x808080, 0.5, 0.5];
      const env = name === 'floor_concrete' || name === 'wall_panel';
      m = new THREE.MeshStandardMaterial({ color: d[0], roughness: env ? d[1] : Math.min(1, d[1] * 1.5), metalness: d[2], roughnessMap: env ? null : name === 'robot_shell' ? rough : rough2 });
      if (name === 'robot_shell') { m.map = shellTex; }
    }
    cache.set(name, m);
    return m;
  };
  const sign = (text: string) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 86;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c9cbc6'; g.fillRect(0, 0, 256, 86);
    g.fillStyle = '#1a1c1e'; g.font = 'bold 54px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 46);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  };
  return {
    get, clone(name, o) { const m = get(name).clone(); if (o) m.setValues(o); return m; },
    decal: () => new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }),
    sign, screen: () => new THREE.MeshStandardMaterial({ color: 0, emissive: 0x20ff80 }), setScreen() {}, setEnvMap() {}, update() {},
  } as MaterialLibrary;
}

/** Visible stand-in fx: debris tumbles with gravity, sparks/explosions are short-lived points + lights. */
function fakeFx(ctx: GameContext): FxSystem {
  const debris: { o: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3; life: number }[] = [];
  const pts: { m: THREE.Mesh; v: THREE.Vector3; life: number; g: number }[] = [];
  const sparkGeo = new THREE.SphereGeometry(0.012, 4, 3);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  const oilMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.15, depthWrite: false });
  const emit = (p: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number, mat: THREE.Material, scale = 1, g = 9, life = 0.6) => {
    for (let i = 0; i < n && pts.length < 400; i++) {
      const m = new THREE.Mesh(sparkGeo, mat); m.position.copy(p); m.scale.setScalar(scale);
      ctx.scene.add(m);
      pts.push({ m, v: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(speed).addScaledVector(dir, speed), life: life * (0.5 + Math.random()), g });
    }
  };
  const counts: Record<string, number> = {};
  const c = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const fx: FxSystem & { counts: Record<string, number> } = {
    counts,
    sparks(p, n, count = 8, speed = 3) { c('sparks'); emit(p, n, count, speed, sparkMat); },
    smoke(p, o) { c('smoke'); emit(p, new THREE.Vector3(0, 0.3, 0), o?.count ?? 4, 0.4, smokeMat, 14 * (o?.size ?? 0.5), -0.5, o?.life ?? 1.5); },
    fluid(p, d, count = 6) { c('fluid'); emit(p, d, count, 2, oilMat, 1.4); },
    decal() { c('decal'); },
    flash(p, color, intensity, duration, distance = 6) {
      c('flash');
      const l = new THREE.PointLight(color, intensity * 4, distance); l.position.copy(p); ctx.scene.add(l);
      setTimeout(() => ctx.scene.remove(l), duration * 1000);
    },
    arc() { c('arc'); },
    explosion(p, scale = 1) { c('explosion'); emit(p, new THREE.Vector3(0, 0.5, 0), 40, 5 * scale, sparkMat, 1.5); fx.flash(p, 0xffa040, 30 * scale, 0.15, 8); fx.smoke(p, { count: 8, size: scale }); },
    debris(p, impulse, meshes, life = 10) {
      c('debris');
      if (!meshes) return;
      for (const o of meshes) {
        ctx.scene.add(o);
        debris.push({ o, v: impulse.clone(), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12), life });
      }
    },
    emitter() { return { stop() {}, enabled: true }; },
    update(dt) {
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.life -= dt;
        d.v.y -= 15 * dt;
        d.o.position.addScaledVector(d.v, dt);
        d.o.rotation.x += d.w.x * dt; d.o.rotation.y += d.w.y * dt; d.o.rotation.z += d.w.z * dt;
        if (d.o.position.y < 0.04) { d.o.position.y = 0.04; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5); if (Math.abs(d.v.y) < 0.5) { d.v.set(0, 0, 0); d.w.set(0, 0, 0); } }
        if (d.life <= 0) { ctx.scene.remove(d.o); debris.splice(i, 1); }
      }
      for (let i = pts.length - 1; i >= 0; i--) {
        const s = pts[i];
        s.life -= dt; s.v.y -= s.g * dt; s.m.position.addScaledVector(s.v, dt);
        if (s.life <= 0) { ctx.scene.remove(s.m); pts.splice(i, 1); }
      }
    },
  };
  return fx;
}

main().catch((e) => { console.error(e); (window as any).__game = { ready: true, debug: { fps: 0 } }; });
