/**
 * Stage 3b clinical gallery for the materials harness (dev/materials.html). Bakes the clinical set as level 4 does.
 *   ?view=clinical[&light=cold|emerg|flash]   grid of the 8 clinical materials (sphere + 2×2 m panel)
 *   ?view=cbooth&mat=name                     split in three: cold-white clean-room lamp | emergency (lights-out) |
 *                                             the player's flashlight alone in the dark; 3 × 3 m wall + floor + sphere
 *                                             (&cy= &dist= move the camera)
 *   ?view=screens4[&time=s]                   containment / video_log / roster / theatre_cam in every state + signs
 *   ?view=screen4&kind=k&text=…&w=m&dist=m    one screen of width w at distance dist, seen with the game camera
 *                                             (72° vertical fov) under the clean-room lamp: legibility frames
 *                                             (&freeze=1 holds every screen at &time=)
 *   ?view=signs4[&light=flash]                clinical signs on wall_clean
 */
import * as THREE from 'three';
import type { MaterialName, ScreenKind } from '../../core/types';
import type { GalleryIO } from './habitat';

export const CLINICAL_VIEWS = ['clinical', 'cbooth', 'screens4', 'screen4', 'signs4'];
const CLINICAL: MaterialName[] = ['wall_clean', 'floor_epoxy', 'ceiling_clean', 'stainless', 'frost', 'tyvek', 'navy_grey', 'deck_nonslip'];

function metreUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
const panel = (w: number, h: number) => metreUV(new THREE.PlaneGeometry(w, h), w, h);
const sphere = (r: number) => metreUV(new THREE.SphereGeometry(r, 96, 64), Math.PI * 2 * r, Math.PI * r);

/** Reflection environment: a white clean room with flush luminaires (on), or the same room dark (lights-out). */
function cleanRoom(dark: boolean) {
  const sc = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 10), new THREE.MeshBasicMaterial({ color: dark ? 0x040506 : 0x8a9196, side: THREE.BackSide }));
  box.position.y = 0.6; sc.add(box);
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(dark ? 0x101418 : 0xf2f6ff).multiplyScalar(dark ? 1 : 4) }));
    m.position.set(x, 2.18, z); sc.add(m);
  }
  if (dark) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ec4ff).multiplyScalar(3) })); e.position.set(3, 2, -4.9); sc.add(e); }
  return sc;
}

/** The three lightings of the brief, each a group (exactly one visible). */
function rigs(scene: THREE.Scene, target: THREE.Vector3, camPos: THREE.Vector3) {
  // clean-room lamp: the BIO lock's spot (16 cd, 0xf4f8ff, 3 m up) + a fill point (4 cd) — 3a's lock rig
  const lamp = new THREE.Group();
  const sp = new THREE.SpotLight(0xf4f8ff, 16, 8, 1.1, 0.5, 2); sp.position.set(target.x + 0.3, 3.0, target.z + 1.6); sp.target.position.copy(target);
  const pf = new THREE.PointLight(0xeef4ff, 4, 6, 2); pf.position.set(target.x - 1.2, 2.9, target.z + 2.2);
  lamp.add(sp, sp.target, pf, new THREE.HemisphereLight(0xdfe8f0, 0x30363a, 0.08));
  // lights-out: one cold emergency point (0x9ec4ff, 4 cd at 2.9 m, 3a's emerg rig) + a red corner lamp
  const emerg = new THREE.Group();
  const pe = new THREE.PointLight(0x9ec4ff, 4, 14, 2); pe.position.set(target.x + 1.4, 2.9, target.z + 2.4);
  const pr = new THREE.PointLight(0xff2a1a, 1.2, 8, 2); pr.position.set(target.x - 1.6, 0.4, target.z + 1.4);
  emerg.add(pe, pr);
  // flashlight alone: the player's (160 cd, 0xcfe0ff, 0.42 rad, penumbra 0.5) from the eye, nothing else
  const flash = new THREE.Group();
  const fl = new THREE.SpotLight(0xcfe0ff, 160, 28, 0.42, 0.5, 2);
  fl.position.copy(camPos).add(new THREE.Vector3(0.18, -0.12, 0)); fl.target.position.copy(target);
  flash.add(fl, fl.target);
  scene.add(lamp, emerg, flash);
  return { lamp, emerg, flash };
}

export function clinicalGallery(io: GalleryIO, view: string): { step: () => void; render?: () => void } {
  const { renderer, scene, camera, lib, q } = io;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envOn = pmrem.fromScene(cleanRoom(false), 0.03).texture;
  const envOff = pmrem.fromScene(cleanRoom(true), 0.03).texture;
  scene.background = new THREE.Color(0x020303);
  // &freeze=1: the screens stay at &time= (a still frame of one state)
  const step = q.get('freeze') === '1' ? () => undefined : () => lib.update(1 / 60);
  const light = q.get('light') ?? 'cold';
  const setEnv = (on: boolean) => { if (q.get('env') !== '0') lib.setEnvMap(on ? envOn : envOff, on ? 0.6 : 0.25); };
  const pick = (r: ReturnType<typeof rigs>, k: string) => {
    r.lamp.visible = k === 'cold'; r.emerg.visible = k === 'emerg'; r.flash.visible = k === 'flash';
    setEnv(k === 'cold');
  };

  if (view === 'clinical') {
    CLINICAL.forEach((n, i) => {
      const m = lib.get(n);
      const x = -4.5 + (i % 4) * 3, y = 1.5 - Math.floor(i / 4) * 3.1;
      const p = new THREE.Mesh(panel(2, 2), m); p.position.set(x - 0.5, y, 0);
      const s = new THREE.Mesh(sphere(0.5), m); s.position.set(x + 0.75, y - 0.45, 0.6);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), lib.sign(n, 'label', 6)); label.position.set(x - 0.5, y + 1.22, 0.01);
      scene.add(p, s, label);
    });
    camera.position.set(0, -0.1, 8.6); camera.lookAt(0, -0.1, 0);
    const g = new THREE.Group(); scene.add(g);
    if (light === 'flash') { const fl = new THREE.SpotLight(0xcfe0ff, 160, 28, 0.6, 0.5, 2); fl.position.set(0.2, -0.2, 8.4); fl.target.position.set(0, -0.1, 0); g.add(fl, fl.target); }
    else if (light === 'emerg') { const pe = new THREE.PointLight(0x9ec4ff, 12, 20, 2); pe.position.set(-4, 3.5, 4); g.add(pe); }
    else { const k = new THREE.PointLight(0xf4f8ff, 40, 30, 2); k.position.set(-5, 4, 4); const f = new THREE.PointLight(0xeef4ff, 10, 30, 2); f.position.set(5, -2, 4); g.add(k, f, new THREE.HemisphereLight(0xdfe8f0, 0x30363a, 0.08)); }
    setEnv(light === 'cold');
    return { step };
  }

  if (view === 'cbooth') {
    const name = (q.get('mat') ?? 'wall_clean') as MaterialName;
    const m = lib.get(name);
    const floorOf: Partial<Record<MaterialName, MaterialName>> = { wall_clean: 'floor_epoxy', ceiling_clean: 'floor_epoxy', stainless: 'floor_epoxy', tyvek: 'floor_epoxy', navy_grey: 'deck_nonslip' };
    const wallOf: Partial<Record<MaterialName, MaterialName>> = { floor_epoxy: 'wall_clean', deck_nonslip: 'navy_grey', tyvek: 'wall_clean' };
    const wall = new THREE.Mesh(panel(3, 3), lib.get(wallOf[name] ?? name)); wall.position.set(0, 1.5, 0);
    const floor = new THREE.Mesh(panel(3, 2.4), lib.get(floorOf[name] ?? name)); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 1.2);
    scene.add(wall, floor);
    const ball = new THREE.Mesh(sphere(0.42), m); ball.position.set(0.85, 0.42, 1.05); scene.add(ball);
    if (name === 'tyvek') {
      // a crumpled suit stand-in: a lumpy capsule lying on the floor
      const geo = metreUV(new THREE.CapsuleGeometry(0.22, 1.0, 12, 32), 1.4, 1.4);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const k = 1 + 0.08 * Math.sin(y * 17 + x * 9) * Math.cos(z * 13 + y * 5);
        pos.setXYZ(i, x * k, y, z * k);
      }
      geo.computeVertexNormals();
      const b = new THREE.Mesh(geo, m); b.rotation.z = Math.PI / 2; b.position.set(-0.55, 0.22, 1.25); scene.add(b);
    }
    if (name === 'stainless') {
      const bench = new THREE.Mesh(metreUV(new THREE.BoxGeometry(1.4, 0.05, 0.7), 1.4, 0.7), m); bench.position.set(-0.6, 0.9, 0.6); scene.add(bench);
    }
    const cy = Number(q.get('cy') ?? 1.6), dist = Number(q.get('dist') ?? 4.6);
    camera.position.set(0, cy, dist);
    const target = new THREE.Vector3(0, 1.0, 0.6);
    camera.lookAt(target);
    const r = rigs(scene, target, camera.position.clone());
    const render = () => {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      camera.aspect = (W / 3) / H; camera.updateProjectionMatrix();
      renderer.setScissorTest(true);
      (['cold', 'emerg', 'flash'] as const).forEach((k, i) => {
        renderer.setViewport(i * W / 3, 0, W / 3, H); renderer.setScissor(i * W / 3, 0, W / 3, H);
        pick(r, k);
        renderer.render(scene, camera);
      });
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    };
    return { step, render };
  }

  if (view === 'signs4') {
    scene.add(new THREE.Mesh(panel(9.5, 5.4), lib.get('wall_clean')));
    const items: [string, number][] = [
      ['← COLD STORE 2 · VIVARIUM', 5], ['RECORDS · UNIT BAY →', 5], ['SURGICAL SUITE ↓', 4],
      ['WET LAB 1\nBSL-2 — GOWNED STAFF ONLY', 4.4], ['NODE 2 — BIO-SYS\nAUTHORISED STAFF', 4.4], ['THEATRE 1 — OBSERVATION GALLERY', 5.2],
      ['CONTAINMENT HOLD\nDO NOT PROP OPEN', 4], ['SERVICE STAIR\nDECK 1 — NAVAL ↓', 4], ['Dr. A. Sunde — PI', 4],
      ['GOWNING\n→', 0.7], ['FUMIGATED — MON 08:41\nDO NOT REMOVE', 2.2], ['COLD STORE 2', 3],
    ];
    items.forEach(([t, a], i) => {
      const h = a < 1 ? 1.0 : a < 2.5 ? 0.3 : 0.4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * a, h), lib.sign(t, 'clinical', a));
      mesh.position.set(-2.9 + (i % 3) * 2.9, 1.8 - Math.floor(i / 3) * 0.95, 0.01);
      if (a < 1) mesh.position.set(-4.3, -1.6, 0.01);
      scene.add(mesh);
    });
    camera.position.set(0, -0.15, 6.0); camera.lookAt(0, -0.15, 0);
    const target = new THREE.Vector3(0, 0, 0);
    const r = rigs(scene, target, camera.position.clone());
    r.lamp.children.forEach((c) => { if ((c as THREE.SpotLight).isSpotLight) { (c as THREE.SpotLight).position.set(0, 3, 4); (c as THREE.SpotLight).intensity = 40; } });
    pick(r, light);
    return { step };
  }

  // shared by screens4 / screen4: a wall_clean wall with the lamp
  const tAdv = Number(q.get('time') ?? 2);
  if (view === 'screen4') {
    const kind = (q.get('kind') ?? 'containment') as ScreenKind;
    const w = Number(q.get('w') ?? 0.8), aspect = Number(q.get('aspect') ?? (kind === 'roster' ? 2 : 1.6));
    const h = w / aspect;
    const wallMat = lib.get(kind === 'roster' ? 'navy_grey' : 'wall_clean');
    scene.add(new THREE.Mesh(panel(8, 4), wallMat));
    const bez = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.04), lib.get('plastic_dark')); bez.position.z = 0.02;
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lib.screen(kind, { text: q.get('text') ?? undefined, aspect }));
    sc.position.z = 0.041;
    scene.add(bez, sc);
    const dist = Number(q.get('dist') ?? 4);
    const yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? 0));
    camera.fov = 72; camera.position.set(Math.sin(yaw) * dist, Number(q.get('dy') ?? 0), Math.cos(yaw) * dist); camera.lookAt(0, 0, 0);
    const r = rigs(scene, new THREE.Vector3(0, -1, 0.5), camera.position.clone());
    r.lamp.children.forEach((c) => { if ((c as THREE.SpotLight).isSpotLight) (c as THREE.SpotLight).position.set(0.5, 2, 2.2); });
    pick(r, light);
    // render while advancing, so the screen counts as seen and redraws at its own rate
    for (let i = 0; i < tAdv * 30; i++) { renderer.render(scene, camera); lib.update(1 / 30); }
    return { step };
  }

  // screens4: every state
  scene.add(new THREE.Mesh(panel(11, 6.4), lib.get('wall_clean')));
  const S: [ScreenKind, string | undefined, number][] = [
    ['containment', 'suite|hold|62:09:14', 1.6], ['containment', 'suite|cleared', 1.6],
    ['containment', 'store|hold|62:09:41', 1.6], ['containment', 'store|ack|62:12:03', 1.6],
    ['video_log', 'idle', 16 / 9], ['video_log', 'play|5|3.2|lean', 16 / 9], ['video_log', 'play|6|2.4|down', 16 / 9], ['video_log', 'static', 16 / 9],
    ['theatre_cam', 'approach|4|5601', 1.5], ['theatre_cam', 'handshake|0.4|5601', 1.5], ['theatre_cam', 'fail|0.5|5601', 1.5], ['theatre_cam', 'regel|2|5601', 1.5],
    ['roster', undefined, 2],
  ];
  S.forEach(([k, text, aspect], i) => {
    const h = k === 'roster' ? 1.2 : 0.75;
    const grp = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(h * aspect + 0.05, h + 0.05, 0.04), lib.get('plastic_dark'));
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), lib.screen(k, { text, aspect }));
    sc.position.z = 0.021;
    grp.add(b, sc);
    if (k === 'roster') grp.position.set(3.6, -2.25, 0.03);
    else grp.position.set(-4.0 + (i % 4) * 1.55, 2.3 - Math.floor(i / 4) * 0.95, 0.03);
    if (k === 'roster') grp.position.set(0, -2.15, 0.03);
    scene.add(grp);
  });
  camera.position.set(0, -0.1, 7.6); camera.lookAt(0, -0.1, 0);
  const r = rigs(scene, new THREE.Vector3(0, -1, 0), camera.position.clone());
  pick(r, 'cold');
  for (let i = 0; i < tAdv * 30; i++) lib.update(1 / 30);
  return { step };
}

