/**
 * First-person framing harness: real Viewmodel parented to a 72° camera, studio-lit backdrop.
 *   &weapon=pistol|shotgun  &clip=<name>&t=<sec> (freeze) | &play=<name> (loop)
 *   &orbit=yaw,pitch,dist   third-person debug view of the same rig
 *   &sprint=1 &move=1 &lower=0.5 &fire=1 (fire every 0.6 s)
 *   &sheet=N ...            contact sheet: N time slices of one action in one image (see runSheet)
 *   &base=x,y,z,rx,ry,rz &lelb=x,y,z &relb=x,y,z &sgrip=yaw:30,rise:24,…   pose overrides for framing experiments
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import type { VmMats } from '../viewmodels/mats';
import { Viewmodel, ShotgunRig, type RigMotion } from '../viewmodels/rig';
import { PISTOL_CLIPS, SHOTGUN_CLIPS } from '../viewmodels/clips';

export async function runFp(o: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; mats: VmMats; lib: MaterialLibrary; q: URLSearchParams; hud: HTMLElement; debug: { fps: number } }) {
  const { renderer, scene, mats, q, hud, debug } = o;
  const cam = new THREE.PerspectiveCamera(Number(q.get('fov') ?? 72), innerWidth / innerHeight, 0.03, 100);
  scene.add(cam);
  // backdrop: floor + wall so the framing reads like in-game
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x2b2e30, roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.65;
  scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.9 }));
  wall.position.set(0, 0, -6);
  scene.add(wall);

  // &sgrip=key:val,key:val… overrides ShotgunRig.SUPPORT (yaw, rise, roll, cx, z, thumbY, thumbZ, arm, elbowOut)
  for (const kv of (q.get('sgrip') ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split(':'); if (k in ShotgunRig.SUPPORT) (ShotgunRig.SUPPORT as any)[k] = Number(v); }
  const vm = new Viewmodel(mats, 0);
  cam.add(vm.root);
  const weapon = (q.get('weapon') ?? 'pistol') as 'pistol' | 'shotgun';
  vm.setActive(weapon);
  const rig = weapon === 'pistol' ? vm.pistol : vm.shotgun;
  const clips = weapon === 'pistol' ? PISTOL_CLIPS : SHOTGUN_CLIPS;
  const clipName = q.get('clip');
  const freezeT = q.get('t');
  const loopName = q.get('play');
  if (clipName && clips[clipName]) {
    rig.play(clips[clipName]);
    if (freezeT !== null) {
      // fast-forward so events fire (mag visibility etc.), then freeze
      const target = Number(freezeT);
      for (let t = 0; t < target - 1e-4; t += 1 / 120) rig.player.update(Math.min(1 / 120, target - t));
      rig.player.speed = 0;
    }
  }
  if (q.get('empty') === '1' && weapon === 'pistol') vm.pistol.slideLocked = true;
  (window as any).__h.vm = vm;
  if (q.get('report')) console.warn('[grip] ' + JSON.stringify(rig.report));
  const hide = q.get('hide') ?? '';
  if (hide.includes('lh')) { rig.lh.root.visible = false; rig.lf.root.visible = false; }
  if (hide.includes('rh')) { rig.rh.root.visible = false; rig.rf.root.visible = false; }
  if (hide.includes('gun')) rig.gun.traverse((o) => { if ((o as THREE.Mesh).isMesh && !rig.rh.root.getObjectById(o.id)) o.visible = false; });

  const nums = (k: string) => q.get(k)?.split(',').map(Number);
  { const b = nums('base'), le = nums('lelb'), re = nums('relb'); if (b) rig.setBase(b[0], b[1], b[2], b[3], b[4], b[5]); if (le) rig.lElbow.set(le[0], le[1], le[2]); if (re) rig.rElbow.set(re[0], re[1], re[2]); }
  if (q.get('sheet')) { runSheet(o, vm, cam); return; }
  const grid = q.get('orbit') === 'grid';
  const orbit = grid ? [0, 0, Number(q.get('dist') ?? 0.42)] : q.get('orbit')?.split(',').map(Number);
  const GRID: [number, number][] = q.get('views') ? q.get('views')!.split(';').map((s) => s.split(',').map(Number) as [number, number]) : [[-90, 8], [-140, 30], [-30, -25], [90, 10]];
  const ocam = new THREE.PerspectiveCamera(Number(q.get('ofov') ?? 35), innerWidth / innerHeight, 0.01, 50);
  const mo: RigMotion = { time: 0, lookX: 0, lookY: 0, speed: 0, bobPhase: 0, grounded: true, vy: 0, sprint: 0, crouch: 0, wall: 0, lower: Number(q.get('lower') ?? 0), strafe: 0 };
  let last = performance.now(), frames = 0, t0 = last, fireT = 0, loopT = 0;
  const center = new THREE.Vector3();
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    mo.time += dt;
    mo.sprint = q.get('sprint') === '1' ? 1 : 0;
    if (q.get('move') === '1' || mo.sprint) { mo.speed = mo.sprint ? 1 : 0.6; mo.bobPhase += dt * (mo.sprint ? 9.5 : 7.5); }
    if (q.get('fire') === '1') {
      fireT -= dt;
      if (fireT <= 0 && !rig.busy) {
        fireT = weapon === 'pistol' ? 0.45 : 1.0;
        if (weapon === 'pistol') vm.pistol.fire(false); else vm.shotgun.fire(() => {});
      }
    }
    if (loopName && clips[loopName] && !rig.busy) { loopT += dt; if (loopT > 0.5) { rig.play(clips[loopName]); loopT = 0; } }
    vm.update(dt, mo);
    cam.updateMatrixWorld(true);
    if (orbit) {
      vm.root.scale.set(1, 1, 1);
      rig.gun.getWorldPosition(center);
      if (q.get('center') === 'lh') rig.lh.root.localToWorld(center.set(0, 0.06, 0));
      else if (q.get('center')) { const c = q.get('center')!.split(',').map(Number); center.set(c[0], c[1], c[2]); }
      const views = grid ? GRID : [[orbit[0], orbit[1]] as [number, number]];
      const W = innerWidth, H = innerHeight, n = views.length > 1 ? 2 : 1;
      renderer.setScissorTest(n > 1);
      views.forEach(([yd, pd], i) => {
        const vx = (i % n) * (W / n), vy = (n - 1 - Math.floor(i / n)) * (H / n);
        renderer.setViewport(vx, vy, W / n, H / n); renderer.setScissor(vx, vy, W / n, H / n);
        const yaw = THREE.MathUtils.degToRad(yd), pitch = THREE.MathUtils.degToRad(pd), d = orbit[2] ?? 0.6;
        ocam.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d);
        ocam.up.set(0, 1, 0);
        // &gframe=1: yaw/pitch measured in the gun's own frame (0 = from behind the stock, -90 = from its left)
        if (q.get('gframe')) { rig.gun.getWorldQuaternion(_gq); ocam.position.applyQuaternion(_gq); ocam.up.applyQuaternion(_gq); }
        ocam.position.add(center);
        ocam.lookAt(center);
        ocam.aspect = W / H; ocam.updateProjectionMatrix();
        renderer.render(scene, ocam);
      });
    } else {
      cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
      renderer.render(scene, cam);
    }
    frames++;
    if (now - t0 > 500) { debug.fps = Math.round(frames * 1000 / (now - t0)); frames = 0; t0 = now; }
    hud.textContent = `${weapon} ${rig.player.name} t=${rig.player.t.toFixed(2)}  calls=${renderer.info.render.calls} tris=${renderer.info.render.triangles}`;
  };
  loop();
}

/**
 * Contact sheet: N time slices of one action in a single image (deterministic fixed-step simulation).
 *   &sheet=N[&cols=C][&from=s&to=s]  &act=clip (uses &clip=a,b,c chained) | fire[&shots=3&gap=0.14] | idle | move | sprint[&off=0.9] | switch
 *   &orbit=yaw,pitch,dist renders the slices from an orbit camera instead of first person; &zoom=1.6&zx=0.6&zy=-0.5 crops the FP view.
 */
function runSheet(o: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; q: URLSearchParams; hud: HTMLElement; debug: { fps: number } }, vm: Viewmodel, cam: THREE.PerspectiveCamera) {
  const { renderer, scene, q, hud } = o;
  const weapon = (q.get('weapon') ?? 'pistol') as 'pistol' | 'shotgun';
  const rig = weapon === 'pistol' ? vm.pistol : vm.shotgun;
  const clips = weapon === 'pistol' ? PISTOL_CLIPS : SHOTGUN_CLIPS;
  const N = Number(q.get('sheet'));
  const cols = Number(q.get('cols') ?? Math.ceil(Math.sqrt(N * 1.4)));
  const rows = Math.ceil(N / cols);
  const act = q.get('act') ?? (q.get('clip') ? 'clip' : 'idle');
  const chain = (q.get('clip') ?? '').split(',').filter((n) => clips[n]);
  const total = act === 'clip' ? chain.reduce((a, n) => a + clips[n].dur, 0) + 0.25 : act === 'fire' ? 0.7 : act === 'switch' ? 0.9 : 1.6;
  const from = Number(q.get('from') ?? 0), to = Number(q.get('to') ?? total);
  const shots = Number(q.get('shots') ?? 1), gap = Number(q.get('gap') ?? 0.14), sprintOff = Number(q.get('off') ?? 1e9);
  const orbit = q.get('orbit')?.split(',').map(Number);
  const ocam = new THREE.PerspectiveCamera(35, 16 / 9, 0.01, 50);
  const zoom = Number(q.get('zoom') ?? 1), zx = Number(q.get('zx') ?? 0), zy = Number(q.get('zy') ?? 0);
  const labels: HTMLElement[] = [];
  for (let i = 0; i < N; i++) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;color:#cfe;font:11px ui-monospace,Menlo,monospace;left:${((i % cols) / cols) * 100}%;top:${(Math.floor(i / cols) / rows) * 100}%;padding:2px 4px;background:#0008`;
    document.body.appendChild(d);
    labels.push(d);
    if (!orbit && zoom === 1) {
      const x = document.createElement('div');
      x.style.cssText = `position:fixed;width:6px;height:6px;border:1px solid #6f6;border-radius:50%;left:calc(${((i % cols + 0.5) / cols) * 100}% - 4px);top:calc(${((Math.floor(i / cols) + 0.5) / rows) * 100}% - 4px)`;
      document.body.appendChild(x);
    }
  }
  hud.style.display = 'none';
  const mo: RigMotion = { time: 0, lookX: 0, lookY: 0, speed: 0, bobPhase: 0, grounded: true, vy: 0, sprint: 0, crouch: 0, wall: 0, lower: 0, strafe: 0 };
  const center = new THREE.Vector3();
  const H = 1 / 120;
  let simT = -1;
  let fired = 0;
  const step = () => {
    const t = simT;
    if (act === 'move') { mo.speed = 0.6; mo.bobPhase += H * 7.5; }
    if (act === 'sprint') { const on = t >= 0 && t < sprintOff; mo.sprint = Math.min(1, Math.max(0, mo.sprint + (on ? H : -H) / 0.25)); mo.speed = 0.6 + 0.4 * mo.sprint; mo.bobPhase += H * (7.5 + 2 * mo.sprint); }
    if (act === 'switch' && t >= 0) mo.lower = t < 0.22 ? t / 0.22 : Math.max(0, 1 - (t - 0.22) / 0.34);
    if (act === 'fire' && t >= fired * gap - 1e-6 && fired < shots && t >= 0) {
      fired++;
      if (weapon === 'pistol') vm.pistol.fire(false); else vm.shotgun.fire(() => {});
    }
    mo.time += H;
    vm.update(H, mo);
    simT += H;
  };
  const playChain = (i: number) => { if (i < chain.length) rig.play(clips[chain[i]], () => playChain(i + 1)); };
  if (weapon === 'shotgun') vm.shotgun.onEvent = (id) => { if (id === 'shellIn') vm.shotgun.saddleCount = Math.max(0, vm.shotgun.saddleCount - 1); };
  const render = () => {
    // restart the simulation: settle idle, then run the action
    rig.cancel();
    if (weapon === 'shotgun') vm.shotgun.saddleCount = 4;
    mo.sprint = 0; mo.lower = 0; mo.speed = 0; fired = 0;
    simT = -1.2;
    while (simT < -1e-6) step();
    simT = 0;
    if (act === 'clip') playChain(0);
    const W = innerWidth, Hh = innerHeight, cw = W / cols, ch = Hh / rows;
    renderer.setScissorTest(true);
    for (let i = 0; i < N; i++) {
      const ti = from + (to - from) * (N === 1 ? 0 : i / (N - 1));
      while (simT < ti - 1e-6) step();
      labels[i].textContent = `${ti.toFixed(2)} ${rig.player.name}`;
      const vx = (i % cols) * cw, vy = (rows - 1 - Math.floor(i / cols)) * ch;
      renderer.setViewport(vx, vy, cw, ch); renderer.setScissor(vx, vy, cw, ch);
      cam.updateMatrixWorld(true);
      if (orbit) {
        vm.root.scale.set(1, 1, 1);
        rig.container.getWorldPosition(center).add(_c.set(rig.basePos.x, rig.basePos.y, rig.basePos.z));
        const yaw = THREE.MathUtils.degToRad(orbit[0]), pitch = THREE.MathUtils.degToRad(orbit[1]), d = orbit[2] ?? 0.6;
        ocam.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * d, center.y + Math.sin(pitch) * d, center.z + Math.cos(yaw) * Math.cos(pitch) * d);
        ocam.lookAt(center);
        ocam.aspect = cw / ch; ocam.updateProjectionMatrix();
        renderer.render(scene, ocam);
      } else {
        cam.aspect = cw / ch;
        if (zoom !== 1) {
          const fw = 1000, fh = fw * ch / cw, w = fw / zoom, h = fh / zoom;
          cam.setViewOffset(fw, fh, (fw - w) * (0.5 + zx * 0.5), (fh - h) * (0.5 - zy * 0.5), w, h);
        }
        cam.updateProjectionMatrix();
        renderer.render(scene, cam);
      }
    }
    renderer.setScissorTest(false);
    hud.textContent = `calls/cell=${renderer.info.render.calls}`;
  };
  render();
  setInterval(render, 700);
}
const _c = new THREE.Vector3();
const _gq = new THREE.Quaternion();
