/**
 * First-person framing harness: real Viewmodel parented to a 72° camera, studio-lit backdrop.
 *   &weapon=pistol|shotgun  &clip=<name>&t=<sec> (freeze) | &play=<name> (loop)
 *   &orbit=yaw,pitch,dist   third-person debug view of the same rig
 *   &sprint=1 &move=1 &lower=0.5 &fire=1 (fire every 0.6 s)
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../../core/types';
import type { VmMats } from '../viewmodels/mats';
import { Viewmodel, type RigMotion } from '../viewmodels/rig';
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
  const hide = q.get('hide') ?? '';
  if (hide.includes('lh')) { rig.lh.root.visible = false; rig.lf.root.visible = false; }
  if (hide.includes('rh')) { rig.rh.root.visible = false; rig.rf.root.visible = false; }
  if (hide.includes('gun')) rig.gun.traverse((o) => { if ((o as THREE.Mesh).isMesh && !rig.rh.root.getObjectById(o.id)) o.visible = false; });

  const grid = q.get('orbit') === 'grid';
  const orbit = grid ? [0, 0, Number(q.get('dist') ?? 0.42)] : q.get('orbit')?.split(',').map(Number);
  const GRID: [number, number][] = [[-90, 8], [-140, 30], [-30, -25], [90, 10]];
  const ocam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 50);
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
      if (q.get('center')) { const c = q.get('center')!.split(',').map(Number); center.set(c[0], c[1], c[2]); }
      const views = grid ? GRID : [[orbit[0], orbit[1]] as [number, number]];
      const W = innerWidth, H = innerHeight, n = views.length > 1 ? 2 : 1;
      renderer.setScissorTest(n > 1);
      views.forEach(([yd, pd], i) => {
        const vx = (i % n) * (W / n), vy = (n - 1 - Math.floor(i / n)) * (H / n);
        renderer.setViewport(vx, vy, W / n, H / n); renderer.setScissor(vx, vy, W / n, H / n);
        const yaw = THREE.MathUtils.degToRad(yd), pitch = THREE.MathUtils.degToRad(pd), d = orbit[2] ?? 0.6;
        ocam.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * d, center.y + Math.sin(pitch) * d, center.z + Math.cos(yaw) * Math.cos(pitch) * d);
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
