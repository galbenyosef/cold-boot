/**
 * Stage 3c navy dock gallery for the materials harness (dev/materials.html). Bakes the navy set as level 5 does.
 * &spin=1 sweeps the beacon (stills hold &phase=, radians, 0 = towards the wall). Lighting states are level 5's (§2.7): `lit` (warm-white 4000 K fluorescents, a dock room probe), `red` (the red
 * emergency / night point, 0xff2a1a), `beacon` (an amber rotating beacon's beam sweeping, 0xff8a1a), `flash` (the
 * player's flashlight alone in the dark: 160 cd, 0xcfe0ff, 0.42 rad).
 *   ?view=navy[&light=lit|red|beacon|flash]   grid of the navy materials (+ the four extras): sphere + 2×2 m panel
 *   ?view=nbooth&mat=name[&time=s]            split in four (lit | red | beacon | flash): 3 × 3 m wall + floor + sphere;
 *                                             wet_steel lies as a puddle on deck_nonslip; deck_grate over a dark pit
 *   ?view=nbig&mat=name[&light=]              a 24 × 12 m wall (or floor) from 10 m: repetition / mottling check
 *   ?view=kit5[&light=]                       a soldier stand-in: fatigues, webbing vest, helmet, balaclava; a bunk
 *                                             with blanket on lino; a hull-white wall with a hazard-deck strip
 *   ?view=screens5[&time=s]                   keypad / launch / dock_status / onpost / palm (Aas, launch) in every state
 *   ?view=screen5&kind=k&text=…&w=m&aspect=a&dist=m[&yaw=deg][&light=]   one screen of width w at distance dist, seen
 *                                             with the game camera (72° vertical fov): legibility frames
 *                                             (&freeze=1 holds every screen at &time=)
 *   ?view=signs5[&light=]                     navy signs on navy_grey and hull_white
 */
import * as THREE from 'three';
import type { MaterialName, ScreenKind } from '../../core/types';
import type { GalleryIO } from './habitat';

export const NAVY_VIEWS = ['navy', 'nbooth', 'nbig', 'kit5', 'screens5', 'screen5', 'signs5'];
const NAVY = ['hull_white', 'deck_grate', 'wet_steel', 'fatigue_navy', 'knit_black', 'helmet_navy', 'webbing', 'rubber_mat',
  'sub_coating', 'lino_navy', 'blanket_wool', 'hazard_deck'] as MaterialName[];
const M = (n: string) => n as MaterialName;

function metreUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
const panel = (w: number, h: number) => metreUV(new THREE.PlaneGeometry(w, h), w, h);
const sphere = (r: number) => metreUV(new THREE.SphereGeometry(r, 96, 64), Math.PI * 2 * r, Math.PI * r);

const WARM = 0xffe6c8;      // 4000 K fluorescent
const RED = 0xff2a1a;
const AMBER = 0xff8a1a;
const TORCH = 0xcfe0ff;

/** Reflection environment: a dock room with warm tube fittings (lit), or the same room black with a red lamp (dark). */
function dockRoom(dark: boolean) {
  const sc = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 12), new THREE.MeshBasicMaterial({ color: dark ? 0x030303 : 0x5b5f60, side: THREE.BackSide }));
  box.position.y = 1; sc.add(box);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: dark ? 0x020202 : 0x2a2d2e }));
  fl.rotation.x = -Math.PI / 2; fl.position.y = -0.99; sc.add(fl);
  if (!dark) for (const [x, z] of [[-2.5, -2], [2.5, -2], [-2.5, 2.5], [2.5, 2.5]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM).multiplyScalar(5) }));
    m.position.set(x, 2.9, z); sc.add(m);
  }
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(RED).multiplyScalar(dark ? 3 : 1) }));
  r.position.set(3, 2.4, -5.9); sc.add(r);
  return sc;
}

interface Rigs { lit: THREE.Group; red: THREE.Group; beacon: THREE.Group; flash: THREE.Group; beam: THREE.SpotLight }
/** The four lightings, each a group (exactly one visible). `target`: what the rig lights; `cam`: the eye. */
function rigs(scene: THREE.Scene, target: THREE.Vector3, cam: THREE.Vector3, scale = 1): Rigs {
  const lit = new THREE.Group();
  // two ceiling tubes as points (11 cd at 3 m, the level's `lamp`) + a weaker far one + a little bounce
  const a = new THREE.PointLight(WARM, 11 * scale, 10 * scale, 2); a.position.set(target.x - 0.8, 3.0, target.z + 1.6);
  const b = new THREE.PointLight(WARM, 7 * scale, 10 * scale, 2); b.position.set(target.x + 1.6, 3.0, target.z + 2.6);
  lit.add(a, b, new THREE.HemisphereLight(0xe8e0d0, 0x2a2a28, 0.06));
  // red emergency / night point: 3 cd, low on the wall, nothing else
  const red = new THREE.Group();
  const pr = new THREE.PointLight(RED, 3 * scale, 9 * scale, 2); pr.position.set(target.x + 1.2, 2.6, target.z + 1.8);
  red.add(pr);
  // rotating amber beacon: a spot from high up, swept round the vertical axis by `setBeacon`
  const beacon = new THREE.Group();
  const beam = new THREE.SpotLight(AMBER, 26 * scale, 22 * scale, 0.5, 0.45, 2);
  beam.position.set(target.x - 1.5, 4.2, target.z + 3.0);
  const glowPt = new THREE.PointLight(AMBER, 0.6 * scale, 6 * scale, 2); glowPt.position.copy(beam.position);
  beacon.add(beam, beam.target, glowPt);
  // flashlight alone
  const flash = new THREE.Group();
  const fl = new THREE.SpotLight(TORCH, 160, 28, 0.42, 0.5, 2);
  fl.position.copy(cam).add(new THREE.Vector3(0.18, -0.12, 0)); fl.target.position.copy(target);
  flash.add(fl, fl.target);
  scene.add(lit, red, beacon, flash);
  return { lit, red, beacon, flash, beam };
}
/** Beacon beam aim at phase `ph` (radians, 1 rev ≈ 1.2 s in the game): sweeps round, tilted down 35°. */
function setBeacon(r: Rigs, ph: number) {
  const p = r.beam.position;
  r.beam.target.position.set(p.x + Math.sin(ph) * 3, p.y - 2.6, p.z - Math.cos(ph) * 3);
  r.beam.target.updateMatrixWorld();
}
type LightK = 'lit' | 'red' | 'beacon' | 'flash';
const LIGHTS: LightK[] = ['lit', 'red', 'beacon', 'flash'];

export function navyGallery(io: GalleryIO, view: string): { step: () => void; render?: () => void } {
  const { renderer, scene, camera, lib, q } = io;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envOn = pmrem.fromScene(dockRoom(false), 0.03).texture;
  const envOff = pmrem.fromScene(dockRoom(true), 0.03).texture;
  scene.background = new THREE.Color(0x020202);
  const time = Number(q.get('time') ?? 2);
  const freeze = q.get('freeze') === '1';
  const light = (q.get('light') ?? 'lit') as LightK;
  const setEnv = (on: boolean) => { if (q.get('env') !== '0') lib.setEnvMap(on ? envOn : envOff, on ? 0.6 : 0.25); };
  let ph = Number(q.get('phase') ?? 0.3);
  // (&spin=1: the beacon sweeps at the game's rate; otherwise it holds &phase= for stills)
  const spin = q.get('spin') === '1';
  const pick = (r: Rigs, k: LightK) => {
    r.lit.visible = k === 'lit'; r.red.visible = k === 'red'; r.beacon.visible = k === 'beacon'; r.flash.visible = k === 'flash';
    setEnv(k === 'lit');
  };
  const step = freeze ? () => undefined : () => lib.update(1 / 60);

  if (view === 'navy') {
    NAVY.forEach((n, i) => {
      const m = lib.get(n);
      const x = -6 + (i % 6) * 2.4, y = 1.6 - Math.floor(i / 6) * 3.0;
      const base = new THREE.Mesh(panel(1.7, 1.7), lib.get(n === 'wet_steel' ? 'deck_nonslip' : n === 'deck_grate' ? 'painted_dark' : n));
      base.position.set(x - 0.35, y, 0);
      scene.add(base);
      if (n === 'wet_steel' || n === 'deck_grate') {
        const ov = new THREE.Mesh(panel(1.7, 1.7), m); ov.position.set(x - 0.35, y, 0.01);
        if (n === 'wet_steel') ov.geometry = metreUV(new THREE.PlaneGeometry(1.7, 1.7), 2, 2);
        scene.add(ov);
      }
      const s = new THREE.Mesh(sphere(0.42), lib.get(n === 'wet_steel' ? 'steel_raw' : n)); s.position.set(x + 0.75, y - 0.55, 0.6);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.28), lib.sign(n, 'label', 6)); label.position.set(x - 0.35, y + 1.05, 0.01);
      scene.add(s, label);
    });
    camera.position.set(0, 0.1, 9.2); camera.lookAt(0, 0.1, 0);
    const r = rigs(scene, new THREE.Vector3(0, 0, 0), camera.position.clone(), 6);
    r.lit.children.forEach((c, k) => { if ((c as THREE.PointLight).isPointLight) c.position.set(k ? 5 : -5, 4, 4); });
    (r.red.children[0] as THREE.PointLight).position.set(0, 2.5, 3);
    r.beam.position.set(-4, 5, 6); setBeacon(r, ph); r.beam.angle = 0.7;
    (r.flash.children[0] as THREE.SpotLight).angle = 0.62;
    pick(r, light);
    return { step };
  }

  if (view === 'nbooth') {
    const name = M(q.get('mat') ?? 'hull_white');
    const floorOf: Partial<Record<string, string>> = { hull_white: 'deck_nonslip', fatigue_navy: 'rubber_mat', knit_black: 'rubber_mat', helmet_navy: 'rubber_mat',
      webbing: 'rubber_mat', sub_coating: 'deck_nonslip', blanket_wool: 'lino_navy', wet_steel: 'deck_nonslip', deck_grate: 'deck_grate' };
    const wallOf: Partial<Record<string, string>> = { deck_grate: 'hull_white', wet_steel: 'hull_white', rubber_mat: 'navy_grey', lino_navy: 'hull_white',
      hazard_deck: 'hull_white', fatigue_navy: 'navy_grey', knit_black: 'navy_grey', helmet_navy: 'navy_grey', webbing: 'navy_grey', blanket_wool: 'hull_white' };
    const wall = new THREE.Mesh(panel(3, 3), lib.get(M(wallOf[name] ?? name))); wall.position.set(0, 1.5, 0);
    const floor = new THREE.Mesh(panel(3, 2.4), lib.get(M(floorOf[name] ?? name))); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 1.2);
    scene.add(wall, floor);
    if (name === 'deck_grate') {
      // the grating is a walkway over a pit: a dark floor 1.4 m below and a lamp-lit crawl strip under it
      floor.position.y = 0; floor.castShadow = true;
      const pit = new THREE.Mesh(panel(3, 2.4), lib.get('steel_raw')); pit.rotation.x = -Math.PI / 2; pit.position.set(0, -1.4, 1.2); pit.receiveShadow = true;
      scene.add(pit);
    }
    if (name === 'wet_steel') {
      const pud = new THREE.Mesh(panel(2, 2), lib.get(name)); pud.rotation.x = -Math.PI / 2; pud.position.set(0.2, 0.004, 2.2); scene.add(pud);
    }
    if ((name as string) === 'hazard_deck') { floor.material = lib.get('deck_nonslip'); const strip = new THREE.Mesh(panel(3, 0.6), lib.get(name)); strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.002, 1.0); scene.add(strip); }
    const ballMat = name === 'wet_steel' ? lib.get('steel_raw') : lib.get(name);
    const ball = new THREE.Mesh(sphere(0.42), ballMat); ball.position.set(0.85, 0.42 + (name === 'deck_grate' ? 0 : 0), 1.05);
    if (name !== 'deck_grate') scene.add(ball);
    const cy = Number(q.get('cy') ?? 1.6), dist = Number(q.get('dist') ?? 4.6);
    camera.position.set(0, cy, dist);
    const target = new THREE.Vector3(0, 1.0, 0.6);
    camera.lookAt(target);
    const r = rigs(scene, target, camera.position.clone());
    if (name === 'wet_steel') {
      // a bulkhead lamp on the wall beyond the puddle: what a corridor puddle mirrors (lit state only)
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM).multiplyScalar(4) }));
      bl.position.set(0.3, 2.2, 0.05);
      const bp = new THREE.PointLight(WARM, 5, 8, 2); bp.position.set(0.3, 2.1, 0.25);
      r.lit.add(bl, bp);
    }
    if (name === 'deck_grate') {
      renderer.shadowMap.enabled = true;
      for (const g of [r.lit, r.flash]) g.children.forEach((c) => { const l = c as THREE.PointLight | THREE.SpotLight; if ((l as THREE.Light).isLight && !(c as THREE.HemisphereLight).isHemisphereLight) l.castShadow = true; });
    }
    setBeacon(r, ph);
    // a probe per lighting state captured from the booth itself (as the level's reflection probes do), so wet and
    // glossy surfaces mirror what is really round them (&probe=0: the generic dock-room environment)
    const probes = new Map<LightK, THREE.Texture>();
    if (q.get('probe') !== '0' && q.get('env') !== '0') {
      for (const k of LIGHTS) {
        pick(r, k);
        probes.set(k, pmrem.fromScene(scene, 0.02, 0.05, 40, { position: new THREE.Vector3(0, 1.2, 2.6) }).texture);
      }
    }
    const render = () => {
      const W = renderer.domElement.width, H = renderer.domElement.height;
      camera.aspect = (W / 4) / H; camera.updateProjectionMatrix();
      renderer.setScissorTest(true);
      LIGHTS.forEach((k, i) => {
        renderer.setViewport(i * W / 4, 0, W / 4, H); renderer.setScissor(i * W / 4, 0, W / 4, H);
        pick(r, k);
        const pe = probes.get(k);
        if (pe) lib.setEnvMap(pe, 1);
        renderer.render(scene, camera);
      });
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    };
    setBeacon(r, ph);
    return { step: () => { step(); if (!freeze && spin) { ph += 1 / 60 * (Math.PI * 2 / 1.2); setBeacon(r, ph); } }, render };
  }

  if (view === 'nbig') {
    const name = M(q.get('mat') ?? 'hull_white');
    const isFloor = ['deck_grate', 'rubber_mat', 'lino_navy', 'hazard_deck', 'wet_steel', 'deck_nonslip'].includes(name);
    const W0 = 24, H0 = 12;
    const s = new THREE.Mesh(panel(W0, H0), lib.get(isFloor && name === 'wet_steel' ? 'deck_nonslip' : name));
    if (isFloor) { s.rotation.x = -Math.PI / 2; s.position.set(0, 0, -H0 / 2); } else s.position.set(0, H0 / 2, 0);
    scene.add(s);
    if (name === 'wet_steel') for (const [x, z] of [[-6, -3], [-1, -7], [4, -4], [8, -9]]) {
      const p = new THREE.Mesh(panel(2, 2), lib.get(name)); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.004, z); scene.add(p);
    }
    camera.fov = 72;
    if (isFloor) { camera.position.set(0, 1.65, 3); camera.lookAt(0, 0, -6); } else { camera.position.set(0, 1.65, 10); camera.lookAt(0, 4.5, 0); }
    camera.updateProjectionMatrix();
    const g = new THREE.Group(); scene.add(g);
    if (light === 'lit') {
      for (let k = 0; k < 6; k++) { const p = new THREE.PointLight(WARM, 11, 10, 2); p.position.set(-10 + k * 4, isFloor ? 3 : 3.2 + (k % 2) * 4, isFloor ? -2 - (k % 3) * 4 : 2.2); g.add(p); }
      g.add(new THREE.HemisphereLight(0xe8e0d0, 0x2a2a28, 0.06));
    } else if (light === 'red') {
      for (const x of [-6, 6]) { const p = new THREE.PointLight(RED, 3, 9, 2); p.position.set(x, 2.6, isFloor ? -4 : 1.5); g.add(p); }
    } else if (light === 'beacon') {
      const sp = new THREE.SpotLight(AMBER, 60, 30, 0.5, 0.45, 2); sp.position.set(0, 9, isFloor ? -6 : 3); sp.target.position.set(-4, isFloor ? 0 : 3, isFloor ? -6 : 0); g.add(sp, sp.target);
    } else {
      const fl = new THREE.SpotLight(TORCH, 160, 28, 0.42, 0.5, 2); fl.position.copy(camera.position); fl.target.position.set(0, isFloor ? 0 : 4.5, isFloor ? -6 : 0); g.add(fl, fl.target);
    }
    setEnv(light === 'lit');
    return { step };
  }

  if (view === 'kit5') {
    const add = (geo: THREE.BufferGeometry, mat: string, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, lib.get(M(mat))); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
    };
    add(panel(6, 3.2), 'hull_white', 0, 1.6, -1);
    const fl = add(panel(6, 4), 'rubber_mat', 0, 0, 1); fl.rotation.x = -Math.PI / 2;
    const st = add(panel(6, 0.4), 'hazard_deck', 0, 0.003, -0.6); st.rotation.x = -Math.PI / 2;
    // soldier stand-in: legs + torso (fatigues), vest box (webbing), head (knit), helmet dome
    const body = new THREE.Group(); body.position.set(-1.2, 0, 0.4); scene.add(body);
    const leg = metreUV(new THREE.CylinderGeometry(0.09, 0.08, 0.86, 24), 0.55, 0.86);
    for (const x of [-0.1, 0.1]) { const l = new THREE.Mesh(leg, lib.get('fatigue_navy')); l.position.set(x, 0.43, 0); body.add(l); }
    const torso = new THREE.Mesh(metreUV(new THREE.CylinderGeometry(0.19, 0.17, 0.62, 28), 1.2, 0.62), lib.get('fatigue_navy')); torso.position.y = 1.17; body.add(torso);
    const vest = new THREE.Mesh(metreUV(new THREE.BoxGeometry(0.42, 0.44, 0.3), 0.44, 0.44), lib.get('webbing')); vest.position.set(0, 1.2, 0.02); body.add(vest);
    for (const x of [-0.12, 0, 0.12]) { const p = new THREE.Mesh(metreUV(new THREE.BoxGeometry(0.1, 0.14, 0.06), 0.14, 0.14), lib.get('webbing')); p.position.set(x, 1.08, 0.19); body.add(p); }
    const arm = metreUV(new THREE.CylinderGeometry(0.055, 0.05, 0.62, 18), 0.35, 0.62);
    for (const x of [-0.25, 0.25]) { const a = new THREE.Mesh(arm, lib.get('fatigue_navy')); a.position.set(x, 1.15, 0); a.rotation.z = x > 0 ? 0.12 : -0.12; body.add(a); }
    const head = new THREE.Mesh(sphere(0.11), lib.get('knit_black')); head.position.y = 1.62; head.scale.set(1, 1.15, 1.05); body.add(head);
    const helm = new THREE.Mesh(metreUV(new THREE.SphereGeometry(0.135, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), 0.85, 0.4), lib.get('helmet_navy')); helm.position.y = 1.66; body.add(helm);
    // bunk with a blanket on lino
    const lino = add(panel(2.6, 2), 'lino_navy', 1.6, 0.001, 0.3); lino.rotation.x = -Math.PI / 2;
    add(metreUV(new THREE.BoxGeometry(1.9, 0.12, 0.8), 1.9, 0.8), 'blanket_wool', 1.6, 0.5, -0.2);
    add(metreUV(new THREE.BoxGeometry(2.0, 0.05, 0.85), 2.0, 0.85), 'navy_grey', 1.6, 0.42, -0.2);
    add(metreUV(new THREE.BoxGeometry(0.6, 0.6, 0.6), 0.6, 0.6), 'sub_coating', 2.6, 0.3, 0.8);
    const pud = add(panel(2, 2), 'wet_steel', -0.2, 0.006, 1.3); pud.rotation.x = -Math.PI / 2; pud.scale.set(0.7, 0.7, 1);
    camera.position.set(0, 1.6, 3.6); camera.lookAt(0.2, 0.9, 0);
    const r = rigs(scene, new THREE.Vector3(0, 0.9, 0), camera.position.clone());
    setBeacon(r, ph); pick(r, light);
    return { step: () => { step(); if (!freeze && spin) { ph += 1 / 60 * (Math.PI * 2 / 1.2); setBeacon(r, ph); } } };
  }

  if (view === 'signs5') {
    const g1 = new THREE.Mesh(panel(5, 5.6), lib.get('navy_grey')); g1.position.set(-2.6, 0, 0); scene.add(g1);
    const g2 = new THREE.Mesh(panel(5, 5.6), lib.get('hull_white')); g2.position.set(2.6, 0, 0); scene.add(g2);
    const items: [string, number][] = [
      ['READY ROOM', 4], ['SPINE — AUTHORISED', 5], ['SUB BAY', 3.2], ['LAUNCH LOCK — ACCESS', 5.4],
      ['BILGE ACCESS — CRAWLWAY TO MAGAZINE — CROUCH', 6.5], ['MAGAZINE — DOGGED FROM BELOW\nACCESS VIA SPINE CRAWLWAY', 4.2],
      ['TRUNK — HEAD-END 200 M ←', 5.5], ['LAUNCH LOCK — FLOODED — 210 BAR', 5.5], ['BERTHING 1\n2-34-0-L', 2.6], ['DIVE LOCKER\n2-41-1-Q', 2.6],
    ];
    items.forEach(([t, a], i) => {
      const h = a > 5 ? 0.32 : 0.42;
      const side = i % 2 === 0 ? -2.6 : 2.6;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(4.6, h * a), h * (Math.min(4.6, h * a) / (h * a))), lib.sign(t, 'navy', a));
      mesh.position.set(side, 2.2 - Math.floor(i / 2) * 1.05, 0.01);
      scene.add(mesh);
    });
    camera.position.set(0, -0.1, 6.6); camera.lookAt(0, -0.1, 0);
    const r = rigs(scene, new THREE.Vector3(0, 0, 0), camera.position.clone(), 3);
    r.lit.children.forEach((c, k) => { if ((c as THREE.PointLight).isPointLight) c.position.set(k ? 3 : -3, 3, 3); });
    (r.red.children[0] as THREE.PointLight).position.set(0, 2.5, 2.5);
    r.beam.position.set(-3, 4, 5); setBeacon(r, ph); (r.flash.children[0] as THREE.SpotLight).angle = 0.6;
    pick(r, light);
    return { step };
  }

  if (view === 'screen5') {
    const kind = (q.get('kind') ?? 'keypad') as ScreenKind;
    const w = Number(q.get('w') ?? 0.3), aspect = Number(q.get('aspect') ?? 1.6);
    const h = w / aspect;
    scene.add(new THREE.Mesh(panel(10, 5), lib.get(M(q.get('wall') ?? 'navy_grey'))));
    const bez = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.04), lib.get('plastic_dark')); bez.position.z = 0.02;
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lib.screen(kind, { text: q.get('text') ?? undefined, aspect }));
    sc.position.z = 0.041;
    scene.add(bez, sc);
    const dist = Number(q.get('dist') ?? 1.2);
    const yaw = THREE.MathUtils.degToRad(Number(q.get('yaw') ?? 0));
    camera.fov = 72; camera.position.set(Math.sin(yaw) * dist, Number(q.get('dy') ?? 0), Math.cos(yaw) * dist); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const r = rigs(scene, new THREE.Vector3(0, -1, 0.5), camera.position.clone());
    setBeacon(r, ph); pick(r, light);
    for (let i = 0; i < time * 30; i++) { renderer.render(scene, camera); lib.update(1 / 30); }
    return { step };
  }

  // screens5: every state
  scene.add(new THREE.Mesh(panel(13, 7.4), lib.get('navy_grey')));
  const S: [ScreenKind, string | undefined, number, number][] = [
    ['keypad', 'off', 0.62, 0.66], ['keypad', 'ready', 0.62, 0.66], ['keypad', '* * _ _', 0.62, 0.66], ['keypad', 'rejected', 0.62, 0.66],
    ['keypad', 'accepted', 0.62, 0.66], ['keypad', 'open', 0.62, 0.66], ['keypad', 'NO AUTHORITY', 1.6, 0.4], ['keypad', 'ENTER CODE', 1.6, 0.4],
    ['launch', 'idle', 1.6, 0.75], ['launch', `running|6`, 1.6, 0.75], ['launch', 'complete', 1.6, 0.75],
    ['dock_status', 'SDV TERN — CRADLE — LAUNCH READY\nTRUNK — NOMINAL\nCOMMAND MODULE — SEALED (INSIDE)\nLINK DRILL — IN PROGRESS 2d 14h 30m', 2.5, 0.9],
    ['dock_status', 'TERN — CRADLE — LAUNCH READY', 4, 0.45], ['dock_status', 'PRE-LAUNCH CHECK — RUNNING', 4, 0.45], ['dock_status', 'COMPLETE — AWAITING OFFICER PALM', 4, 0.45],
    ['onpost', '26', 2, 0.6], ['onpost', '27', 2, 0.6],
    ['palm', 'white|done|AAS, L. (LT.) — PALM — LIVE — 21:52', 1.14, 0.5], ['palm', 'white|standby|LAUNCH', 1.14, 0.5], ['palm', 'white|scan|LAUNCH|1.6', 1.14, 0.5], ['palm', 'white|fail|NOT ROSTERED — REYES, S.', 1.14, 0.5],
    ['terminal_idle', '[plain]GATE 4 — LAST AUTHORISED: AAS, L. (LT.) — PALM — LIVE — 21:52\nPREVIOUS: AAS, L. (LT.) — TUE 21:52\nPREVIOUS: AAS, L. (LT.) — TUE 03:15', 1.6, 0.6],
    ['terminal_idle', 'TRUNK TUNNEL — CO\'S AUTHORITY', 1.6, 0.6],
  ];
  // grid layout: rows of mixed widths
  let x = -6.2, y = 3.1, rowH = 0;
  for (const [k, text, aspect, h] of S) {
    const w = h * aspect;
    if (x + w > 6.3) { x = -6.2; y -= rowH + 0.18; rowH = 0; }
    const grp = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.04), lib.get('plastic_dark'));
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lib.screen(k, { text, aspect }));
    sc.position.z = 0.021;
    grp.add(b, sc);
    grp.position.set(x + w / 2, y - h / 2, 0.03);
    scene.add(grp);
    x += w + 0.15; rowH = Math.max(rowH, h);
  }
  camera.position.set(0, -0.3, 8.4); camera.lookAt(0, -0.3, 0);
  const r = rigs(scene, new THREE.Vector3(0, -1, 0), camera.position.clone(), 3);
  pick(r, 'lit');
  for (let i = 0; i < time * 30; i++) lib.update(1 / 30);
  return { step };
}
