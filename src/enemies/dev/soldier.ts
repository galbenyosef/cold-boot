/**
 * Soldier rig dev page (stage 3c W3a): /src/enemies/dev/soldier.html — real render, materials and fx.
 *
 *   ?poses=hold,aim,crouch,…   one soldier per pose in a row along x (1.5 m apart); ?pose=aim for one
 *   &arms=carbine|pistol|mix   (mix alternates)            &yaw=<deg> facing (default 180 = toward +z / the 'front' camera)
 *   &cam=front|back|left|right|q|qb|ql|top|close &dist=<m> &camy=<m> &fov=<deg> &cx=<m> (look-at x)
 *   &light=lit|dark|black      lit room / one dim emergency light / nothing (marks + weapon lights only)
 *   &wlight=1                  every weapon light on          &flash=1  a flashlight from the camera
 *   &aim=cam|x,y,z|none        aim / look target (default: 8 m ahead at eye height)
 *   &walk=line|circle|strafe|back|turn &speed=<m/s>          the soldiers move (planted-feet gait)
 *   &seq=pose@t,pose@t         pose changes (also flinch, stagger, reload)     &fire=<period s> fire while aimed
 *   &death=fwd|back|side &at=<s>  &wall=<m> a wall that far behind each soldier (sit-back death)
 *   &cover=low|high            a 1.2 m crate / a 2.4 m wall 0.55 m in front (peeks: &poses=crouch,lean_l)
 *   &actor=1                   the cutscene puppet: turns, looks at the camera, speaks, turns away (nape), walks out
 *   &t=<s> pre-simulate        &slow=<k>         &lod=0|1 force      &nohud=1
 * window.__dev: rigs, sim(seconds), stats(), lowest() (lowest skinned vertex y per soldier), cost(n)
 */
import * as THREE from 'three';
import type { GameContext, LightHandle, Quality } from '../../core/types';
import { createEvents } from '../../core/events';
import { createPhysics } from '../../physics/physics';
import { createRender } from '../../render/index';
import { createMaterials } from '../../materials/index';
import { createFx } from '../../fx/index';
import { buildSoldierTemplate } from '../soldier/model';
import { createSoldierRig, type SoldierPose, type SoldierRigEx } from '../soldier/rig';
import { setMarkTime } from '../shared/rig';
import { SoldierActor } from '../soldier/actor';
import type { EnemyWorld } from '../ai';

const q = new URLSearchParams(location.search);
const P = (k: string, d: string) => q.get(k) ?? d;

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(P('fov', '40')), innerWidth / innerHeight, 0.05, 200);
  scene.add(camera);
  const debug = { quality: (q.get('quality') as Quality | null) ?? 'high', fps: 0, verbose: true };
  const ctx = { canvas, scene, camera, debug, state: 'playing', ready: false, time: 0, levelId: 5, facts: {} } as unknown as GameContext;
  (window as unknown as { __game: unknown }).__game = ctx;
  ctx.events = createEvents();
  ctx.physics = createPhysics();
  ctx.render = await createRender(ctx);
  ctx.materials = await createMaterials(ctx);
  ctx.fx = await createFx(ctx);
  ctx.audio = { play() {}, loop() { return { setVolume() {}, setPosition() {}, stop() {} }; }, say() { return { duration: 2, done: Promise.resolve(), setPosition() {}, stop() {} }; } } as unknown as GameContext['audio'];
  const lib = ctx.materials, L = ctx.render.lights;
  const lightMode = P('light', 'lit');

  // ── greybox room: floor, walls, optional cover
  const colliders: THREE.Mesh[] = [];
  const bx = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m = 'painted_dark') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), lib.get(m as never));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh); colliders.push(mesh);
    return mesh;
  };
  bx(-15, -0.2, -15, 15, 0, 15, P('floor', 'painted_dark'));
  bx(-15, 0, -8.2, 15, 4, -8, 'wall_panel');
  bx(-15, 4, -15, 15, 4.2, 15, 'ceiling_panel');
  bx(-15.2, 0, -15, -15, 4, 15, 'wall_panel'); bx(15, 0, -15, 15.2, 4, 15, 'wall_panel');

  // ── soldiers
  const tpl = buildSoldierTemplate(ctx);
  let poses = (q.get('poses') ?? q.get('pose') ?? 'hold').split(',') as SoldierPose[];
  // &yaws=180,90,0,-90 : the same pose seen from several sides in one frame (one soldier per facing)
  const yaws = q.get('yaws') ? q.get('yaws')!.split(',').map((y) => Number(y) * Math.PI / 180) : null;
  if (yaws && poses.length === 1) poses = yaws.map(() => poses[0]);
  const armsQ = P('arms', 'carbine');
  const yaw0 = Number(P('yaw', '180')) * Math.PI / 180;
  const n = poses.length;
  const rigs: SoldierRigEx[] = [];
  const spacing = Number(P('gap', '1.5'));
  const base: THREE.Vector3[] = [];
  const wall = q.get('wall'), cover = q.get('cover');
  for (let i = 0; i < n; i++) {
    const arms = armsQ === 'mix' ? (i % 2 ? 'pistol' : 'carbine') : armsQ === 'pistol' ? 'pistol' : 'carbine';
    const r = createSoldierRig(ctx, tpl, { arms, seed: i * 1.37 + 0.2 });
    const x = (i - (n - 1) / 2) * spacing;
    r.root.position.set(x, 0, 0);
    r.root.rotation.y = yaws ? yaws[i % yaws.length] : yaw0;
    base.push(r.root.position.clone());
    scene.add(r.root);
    rigs.push(r);
    // facing vector (game yaw: 0 faces −z)
    const fx = -Math.sin(r.root.rotation.y), fz = -Math.cos(r.root.rotation.y);
    if (wall) {
      const d = Number(wall), cx = x - fx * (d + 0.1), cz = -fz * (d + 0.1), hx = Math.abs(fx) * 0.1 + Math.abs(fz) * 0.6, hz = Math.abs(fz) * 0.1 + Math.abs(fx) * 0.6;
      bx(cx - hx, 0, cz - hz, cx + hx, 1.2, cz + hz);
    }
    if (cover) { const h = cover === 'high' ? 2.4 : 1.2; const cx = x + fx * 0.85, cz = fz * 0.85, hx = Math.abs(fx) * 0.3 + Math.abs(fz) * 0.5, hz = Math.abs(fz) * 0.3 + Math.abs(fx) * 0.5; bx(cx - hx, 0, cz - hz, cx + hx, h, cz + hz, 'painted_yellow'); }
  }
  for (const r of rigs) r.setPose(poses[rigs.indexOf(r)], 0.01);
  ctx.physics.build(colliders);

  // ── actor (cutscene choreography)
  let actor: SoldierActor | null = null;
  const camAnchor = new THREE.Object3D(); scene.add(camAnchor);
  if (q.get('actor') === '1') {
    const world = { ctx, enemies: [], actors: [], time: 0, rand: Math.random, playerPos: new THREE.Vector3(), playerEye: camera.position, playerVel: new THREE.Vector3(), playerAlive: true,
      playerEyeAgo: (_s: number, o: THREE.Vector3) => o.copy(camera.position), onDeath() {}, forceLod: -1, whisperUntil: 0, provoke() {}, treadSyncUntil: 0 } as unknown as EnemyWorld;
    for (const r of rigs) { r.dispose(); }
    rigs.length = 0;
    actor = new SoldierActor(world, tpl, new THREE.Vector3(0, 0, 0), Math.PI / 2, { dormant: false, actor: true, pose: 'hold', name: 'BREKKE' });
  }

  // ── lights
  const lights: LightHandle[] = [];
  if (lightMode === 'lit') {
    lights.push(L.add({ type: 'point', position: new THREE.Vector3(-2, 3.6, 2), color: 0xfff1e0, intensity: 160, distance: 14, castShadow: true }));
    lights.push(L.add({ type: 'point', position: new THREE.Vector3(3, 3.6, -3), color: 0xe8f0ff, intensity: 90, distance: 12 }));
    lights.push(L.add({ type: 'point', position: new THREE.Vector3(0, 3.6, 6), color: 0xfff1e0, intensity: 90, distance: 12 }));
  } else if (lightMode === 'dark') {
    lights.push(L.add({ type: 'point', position: new THREE.Vector3(4, 2.6, -6), color: 0xff3a20, intensity: 1.6, distance: 10 }));
  }
  const flash = q.get('flash') === '1' ? L.add({ type: 'spot', position: camera.position.clone(), target: new THREE.Vector3(), color: 0xfff1dc, intensity: 60, distance: 22, angle: 0.42, penumbra: 0.6, castShadow: true, priority: 10 }) : null;
  if (q.get('wlight') === '1') for (const r of rigs) r.setLight(true);
  const lodF = q.get('lod');
  if (lodF) for (const r of rigs) r.lod(Number(lodF) as 0 | 1);

  // ── camera
  const camName = P('cam', 'q');
  const dist = Number(P('dist', String(3.4 + n * 0.75)));
  const camY = Number(P('camy', '1.3'));
  const cx = Number(P('cx', '0'));
  const lookY = Number(P('looky', '0.95'));
  const dirs: Record<string, [number, number]> = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0], q: [0.62, 0.78], qb: [-0.62, -0.78], ql: [-0.62, 0.78], qr: [0.62, -0.78], top: [0.01, 0.4], close: [0.35, 0.94] };
  const setCam = () => {
    const [dx, dz] = dirs[camName] ?? dirs.q;
    // directions are relative to the soldier's front (game yaw0: front = (−sin, −cos))
    const fx = -Math.sin(yaw0), fz = -Math.cos(yaw0), lx = -fz, lz = fx; // his left in world (front rotated +90°)
    const wx = fx * dz - lx * dx, wz = fz * dz - lz * dx;
    camera.position.set(cx + wx * dist, camName === 'top' ? 7 : camY, wz * dist);
    camera.lookAt(cx, lookY, 0);
  };
  if (!actor) setCam(); else { camera.position.set(6.7, 1.65, 0); camera.lookAt(0, q.get('nape') === '1' ? 1.55 : 1.5, 0); }
  camAnchor.position.copy(camera.position);

  // ── aim target
  const aimQ = P('aim', '');
  const aimPt = new THREE.Vector3();
  const aimAt = (i: number): THREE.Vector3 | null => {
    if (aimQ === 'none') return null;
    if (aimQ === 'cam') return aimPt.copy(camera.position);
    if (aimQ) { const a = aimQ.split(',').map(Number); return aimPt.set(a[0], a[1], a[2]); }
    const r = rigs[i];
    const fx = -Math.sin(r.root.rotation.y), fz = -Math.cos(r.root.rotation.y);
    return aimPt.set(r.root.position.x + fx * 8, 1.55, r.root.position.z + fz * 8);
  };

  // ── timeline
  const seq = (q.get('seq') ?? '').split(',').filter(Boolean).map((s) => { const [p, t] = s.split('@'); return { p: p as SoldierPose, t: Number(t), done: false }; });
  const death = q.get('death') as 'fwd' | 'back' | 'side' | null, deathAt = Number(P('at', '1'));
  let died = false;
  const firePeriod = Number(P('fire', '0'));
  let fireT = 0;
  const walk = q.get('walk'), speed = Number(P('speed', '1.4'));
  let t = 0;
  const slow = Number(P('slow', '1'));
  const perf: number[] = [];

  const actorScript = (time: number) => {
    if (!actor) return;
    // §4.2 in miniature: head to the camera at 1.0, body at 1.5, speak 12.6 / 15.5, turn away 17.45, walk 20.95
    if (time > 1.0 && !(actor as any)._l) { (actor as any)._l = 1; actor.puppetLookObject(camAnchor); }
    if (time > 1.5 && !(actor as any)._f) { (actor as any)._f = 1; actor.prop('face', camera.position.clone()); }
    if (time > 4.0 && !(actor as any)._s1) { (actor as any)._s1 = 1; actor.puppetSpeak(2.4); }
    if (time > 7.0 && !(actor as any)._s2) { (actor as any)._s2 = 1; actor.puppetSpeak(1.3); }
    if (time > 9.0 && !(actor as any)._t) { (actor as any)._t = 1; actor.puppetLook(null); actor.prop('face', q.get('nape') === '1' ? new THREE.Vector3(-4, 0, 0.3) : new THREE.Vector3(-0.4, 0, -2.2)); }
    if (time > 12.2 && q.get('nape') !== '1' && !(actor as any)._w) { (actor as any)._w = 1; actor.puppetMove(new THREE.Vector3(-0.4, 0, -2.2), 1.4, () => { actor!.puppetMove(new THREE.Vector3(-0.4, 0, -4.0), 1.4, () => {}); }); }
  };

  const markT = q.get('marktime');
  const sim = (dt: number) => {
    t += dt; ctx.time = t;
    if (markT !== null) setMarkTime(Number(markT));
    for (const s of seq) if (!s.done && t >= s.t) { s.done = true; for (const r of rigs) r.setPose(s.p); }
    if (death && !died && t >= deathAt) {
      died = true;
      for (const r of rigs) {
        const f = new THREE.Vector3(-Math.sin(r.root.rotation.y), 0, -Math.cos(r.root.rotation.y));
        const d = death === 'fwd' ? f : death === 'back' ? f.clone().negate() : new THREE.Vector3(f.z, 0, -f.x);
        void r.die(death, d);
      }
    }
    if (firePeriod > 0) { fireT += dt; if (fireT >= firePeriod) { fireT = 0; for (const r of rigs) if (!r.dead && r.pose !== 'reload') r.fire(); } }
    rigs.forEach((r, i) => {
      if (walk && !r.dead) {
        const b = base[i], w = t * speed;
        if (walk === 'line') { const L2 = 4, ph = (w % (2 * L2)); const fwd = ph < L2; r.root.position.set(b.x, 0, b.z + (fwd ? -L2 / 2 + ph : L2 / 2 - (ph - L2))); r.root.rotation.y = fwd ? Math.PI : 0; }
        else if (walk === 'circle') { const R = 2.2, a = w / R; r.root.position.set(b.x + Math.cos(a) * R - R, 0, b.z + Math.sin(a) * R); r.root.rotation.y = Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI; }
        else if (walk === 'strafe') { const ph = Math.sin(t * speed / 1.6); r.root.position.set(b.x + ph * 1.6, 0, b.z); }
        else if (walk === 'back') { const L2 = 3, ph = (w % (2 * L2)); r.root.position.set(b.x, 0, b.z + (ph < L2 ? -ph : ph - 2 * L2)); }
        else if (walk === 'turn') { r.root.rotation.y = yaw0 + Math.sin(t * 0.5) * 1.6; }
        r.setMove(speed, r.root.rotation.y);
      }
      r.aim(aimAt(i));
      const t0 = performance.now();
      r.update(dt);
      perf.push(performance.now() - t0);
      if (perf.length > 240) perf.shift();
    });
    if (actor) { actorScript(t); camAnchor.position.copy(camera.position); actor.update(dt); }
    if (flash) { const f = new THREE.Vector3(); camera.getWorldDirection(f); flash.position.copy(camera.position); flash.target.copy(camera.position).addScaledVector(f, 5); }
    lib.update(dt);
    ctx.fx.update(dt);
  };

  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); ctx.render.resize(innerWidth, innerHeight); };
  addEventListener('resize', onResize); onResize();
  await ctx.render.prepare([new THREE.Vector3(0, 1.5, 0)]);
  const pre = Number(P('t', '0'));
  for (let k = 0; k < pre * 60; k++) sim(1 / 60);
  let last = performance.now(), acc = 0, frames = 0;
  const tpl0 = tpl.rig;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const raw = Math.min((now - last) / 1000, 0.05); last = now;
    acc += raw; frames++;
    if (acc >= 0.5) {
      debug.fps = Math.round(frames / acc); acc = 0; frames = 0;
      if (q.get('nohud') !== '1') {
        const s = (ctx.render as unknown as { stats(): { calls: number; triangles: number } }).stats();
        const avg = perf.reduce((a, b) => a + b, 0) / Math.max(1, perf.length);
        hud.textContent = `fps ${debug.fps}  calls ${s.calls} tris ${s.triangles}  t ${t.toFixed(2)}\n` +
          `soldier: LOD0 ${tpl0.triangles} tris / ${tpl0.drawCalls} meshes · LOD1 ${tpl0.lod1Triangles} / ${tpl0.lod1.length} · shadow ${tpl0.shadowTriangles} · bones ${tpl0.bones.length}\n` +
          `per soldier draw calls now: ${rigs.map((r) => r.drawCalls).join(' ')}  rig update ${avg.toFixed(3)} ms\n` +
          rigs.map((r) => `${r.pose}${r.dead ? ' dead' : ''} led ${r.led} sight ${((r as unknown as { sightErr: number }).sightErr * 100).toFixed(1)}cm`).join(' | ');
      }
    }
    sim(raw * slow);
    ctx.render.render(raw * slow);
  };
  ctx.ready = true;
  requestAnimationFrame(frame);
  const v = new THREE.Vector3();
  (window as unknown as { __dev: unknown }).__dev = {
    rigs, actor, ctx,
    sim(seconds: number) { for (let k = 0; k < seconds * 60; k++) sim(1 / 60); },
    stats() { return { lod0: tpl0.triangles, calls0: tpl0.drawCalls, lod1: tpl0.lod1Triangles, calls1: tpl0.lod1.length, shadow: tpl0.shadowTriangles, bones: tpl0.bones.length, drawCalls: rigs.map((r) => r.drawCalls) }; },
    lowest() {
      return rigs.map((r) => {
        let lo = Infinity, name = '';
        const per: Record<string, number> = {};
        r.root.updateMatrixWorld(true);
        r.lodRig.root.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (!m.isSkinnedMesh || !m.visible || m.userData.key === 'glow' || m.userData.key === undefined || String(m.userData.key).startsWith('gun')) return;
          const pos = m.geometry.getAttribute('position'), si = m.geometry.getAttribute('skinIndex'), sw = m.geometry.getAttribute('skinWeight');
          for (let i = 0; i < pos.count; i += 2) {
            m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
            let bi = si.getX(i), bw = sw.getX(i);
            for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k); }
            const bn = r.lodRig.bones[bi].name;
            if (per[bn] === undefined || v.y < per[bn]) per[bn] = v.y;
            if (v.y < lo) { lo = v.y; name = bn; }
          }
        });
        const pen: Record<string, number> = {};
        for (const [k, y] of Object.entries(per)) if (y < 0.005) pen[k] = +y.toFixed(3);
        return { lo: +lo.toFixed(3), bone: name, eye: +r.eye.y.toFixed(3), below: pen };
      });
    },
    probe() { return rigs.map((r) => (r as unknown as { probe(): unknown }).probe()); },
    tris() {
      const t0 = tpl0, f = (ms: { key: string; geometry: THREE.BufferGeometry }[]) => ms.map((m) => m.key + ':' + (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.getAttribute('position').count / 3)).join(' ');
      return { lod0: f(t0.meshes), lod1: f(t0.lod1), shadow: t0.shadowTriangles };
    },
    cost(nf = 300) { const a = performance.now(); for (let k = 0; k < nf; k++) rigs.forEach((r) => { r.aim(aimAt(0)); r.update(1 / 60); }); return (performance.now() - a) / nf / Math.max(1, rigs.length); },
  };
}
async function report() {
  const want = (q.get('log') ?? '').split(',').filter(Boolean);
  if (!want.length) return;
  await new Promise((r) => setTimeout(r, Number(q.get('logat') ?? '1500')));
  const d = (window as unknown as { __dev: Record<string, (...a: unknown[]) => unknown> }).__dev;
  for (const k of want) console.warn('[dev] ' + k + ' ' + JSON.stringify(d[k]()));
}
main().then(report).catch((e) => { console.error(e); document.getElementById('hud')!.textContent = String(e?.stack ?? e); });
