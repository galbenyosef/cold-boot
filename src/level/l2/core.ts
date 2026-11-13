/**
 * CHOIR — NODE 5 — x -8…8, z -88…-72, h 6. One cold, clean, bright room: three tall cell columns with
 * breaker handles, the pedestal console, CHOIR's waveform on every wall. And the SERVICE LIFT behind it
 * (x -2…2, z -93…-88) — the way out.
 */
import * as THREE from 'three';
import { rng } from '../builder';
import type { LevelBuild, MachineState } from '../context';
import { cableBundle, floorSlab, handrail, lathe, panelOn } from '../kit';
import { wallTerminal } from '../props';
import { ceilingSlab, wallFace } from '../structure';
import { easeIn, easeInOut } from '../ambient';

const PI = Math.PI;
const H = 6;
const CELLS: [number, number][] = [[-4.6, -83.2], [0, -84.6], [4.6, -83.2]];

export function buildCore(L: LevelBuild) {
  const b = L.builder('core');
  const R = rng(2901);
  L.room('core', 'CHOIR — NODE 5', -8, 8, -88, -72, H);
  floorSlab(b, 'wall_medical', -8, -88, 8, -72, [], 'metal');
  ceilingSlab(b, -8.2, -88, 8.2, -72, H, 'painted_white');
  const st = { h: H, t: 0.2, style: 'medical' as const, trayY: 0, features: 0, bay: 2.0 };
  wallFace(b, { ...st, n: '-z', plane: -72.2, from: -8, to: 8, openings: [{ c: 0, w: 3.0, h: 2.8 }], seed: 291 });
  wallFace(b, { ...st, n: '+z', plane: -87.8, from: -8, to: 8, openings: [{ c: 0, w: 1.6, h: 2.4 }], seed: 292 });
  wallFace(b, { ...st, n: '+x', plane: -8, from: -87.8, to: -72.2, seed: 293 });
  wallFace(b, { ...st, n: '-x', plane: 8, from: -87.8, to: -72.2, seed: 294 });
  // vestibule from the hall door to the room (not a room itself)
  const vb = L.builder('core_vest');
  vb.rooms = ['line', 'core'];
  floorSlab(vb, 'wall_medical', -1.9, -72.2, 1.9, -70.0, [], 'metal');
  ceilingSlab(vb, -1.9, -72.2, 1.9, -70.0, 3.0, 'painted_white');
  for (const [x, n] of [[-1.7, '+x'], [1.7, '-x']] as const) wallFace(vb, { n, plane: x, from: -72.2, to: -70.2, h: 3.0, t: 0.25, style: 'medical', trayY: 0, features: 0, seed: 295 });
  L.navNode(0, -71.1, 'core');
  // the luminous ceiling: a grid of light panels, bound to the room's lights
  const mains: ReturnType<LevelBuild['point']>[] = [];
  for (const [x, z] of [[-4.5, -76], [4.5, -76], [-4.5, -83], [4.5, -83], [0, -79.5], [0, -86.5], [0, -74]] as const) mains.push(L.point('core', x, H - 0.6, z, 0xe8f4ff, 22, 13, { priority: 2 }));
  const ceilGlow = L.glow(mains[4], 'emissive_white', 0.9);
  b.detail(() => {
    for (let x = -6.6; x <= 6.61; x += 2.2) for (let z = -86.6; z <= -73.39; z += 2.2) {
      b.box(ceilGlow, x, H - 0.02, z, 1.9, 0.02, 1.9);
      b.box('trim_steel', x, H - 0.03, z + 1.1, 2.2, 0.03, 0.04);
    }
  });
  // floor: a ring of light around the pedestal, seams
  const ringMat = L.ctx.materials.clone('emissive_cyan');
  ringMat.emissiveIntensity = 1.6;
  b.detail(() => {
    b.torus(ringMat, 0, 0.005, -79.4, 2.6, 0.025, 'y', 64);
    b.torus(ringMat, 0, 0.005, -79.4, 3.1, 0.012, 'y', 64);
    for (let x = -6; x <= 6; x += 2) b.box('trim_steel', x, 0.002, -80, 0.02, 0.004, 15.6);
  });
  // battery fallback (amber, off until core_cells_out)
  for (const [x, z] of [[-6, -74], [6, -74], [-6, -86], [6, -86]] as const) L.point('core_battery', x, 4.5, z, 0xffa040, 10, 10, { enabled: false, flicker: 'pulse' });

  // ── the waveform on every wall ──
  L.screen('core_wall_1', 'choir', 9.0, 2.6, 0, 4.4, -72.2 - 0.04, '-z');
  L.screen('core_wall_2', 'choir', 12.0, 3.6, 8 - 0.04, 3.3, -80, '-x');
  L.screen('core_wall_3', 'choir', 9.0, 2.6, 0, 4.4, -87.8 + 0.04, '+z');
  L.screen('core_wall_4', 'choir', 12.0, 3.6, -8 + 0.04, 3.3, -80, '+x');
  for (const [x, z, w, h, ry] of [[0, -72.21, 9.2, 2.8, PI], [7.99, -80, 12.2, 3.8, -PI / 2], [0, -87.79, 9.2, 2.8, 0], [-7.99, -80, 12.2, 3.8, PI / 2]] as const) {
    b.at(x, 0, z, ry, () => { b.box('painted_dark', 0, w > 10 ? 3.3 : 4.4, -0.01, w, h, 0.02); b.box('trim_steel', 0, (w > 10 ? 3.3 : 4.4) - h / 2 - 0.04, 0.02, w + 0.1, 0.06, 0.08); });
  }
  // the eye above the pedestal: turns to the player on core_bow
  const eyePivot = new THREE.Group();
  eyePivot.position.set(0, 3.7, -79.4);
  const eye = L.screen('core_eye', 'choir', 2.2, 1.3, 0, 0, 0, '+z', { parent: eyePivot });
  const eyeBack = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.4, 0.08), L.ctx.materials.get('painted_white'));
  eyeBack.position.z = -0.05;
  eyePivot.add(eyeBack);
  eyePivot.userData.rooms = ['core'];
  L.root.add(eyePivot);
  void eye;
  b.detail(() => { for (const s of [-1, 1]) b.rod('trim_steel', s * 0.9, 4.4, -79.4, s * 0.6, H, -79.4, 0.012, 4); });

  // ── the three cell columns ──
  const cellMats: THREE.MeshStandardMaterial[] = [];
  const handles: THREE.Group[] = [];
  CELLS.forEach(([x, z], i) => {
    const m = L.ctx.materials.clone('emissive_cyan');
    m.emissive.set(0x9fe8ff);
    m.emissiveIntensity = 2.2;
    cellMats.push(m);
    b.at(x, 0, z, 0, () => {
      lathe(b, 'painted_white', [[0.001, 0], [0.95, 0], [0.95, 0.2], [0.8, 0.35], [0.7, 0.6], [0.001, 0.62]], 0, 0, 0, 32);
      lathe(b, 'painted_white', [[0.001, H], [0.85, H], [0.85, H - 0.25], [0.7, H - 0.5], [0.001, H - 0.52]], 0, 0, 0, 32);
      // stacked cells inside a glass sleeve
      b.detail(() => {
        for (let k = 0; k < 11; k++) {
          const y = 0.8 + k * 0.42;
          b.cyl(m, 0, y, 0, 0.42, 0.26, 'y', 24);
          b.cyl('trim_steel', 0, y + 0.18, 0, 0.46, 0.06, 'y', 24);
        }
        for (let k = 0; k < 6; k++) { const a = (k * PI) / 3; b.rod('chrome', Math.cos(a) * 0.62, 0.6, Math.sin(a) * 0.62, Math.cos(a) * 0.62, H - 0.5, Math.sin(a) * 0.62, 0.025, 6); }
      });
      b.detail(() => b.cyl(L.ctx.materials.get('glass'), 0, (H - 1.1) / 2 + 0.6, 0, 0.6, H - 1.1, 'y', 32));
      // breaker housing at the front (facing the pedestal)
      b.push(0, 0, 0, Math.atan2(-x, -79.4 - z));
      b.box('painted_white', 0, 1.05, 0.98, 0.5, 0.9, 0.22);
      b.detail(() => {
        b.box('painted_dark', 0, 1.05, 1.095, 0.3, 0.62, 0.012);
        b.sign('CELL ' + (i + 1), 'label', 0, 1.62, 1.095, 0.3, 0.07, '+z');
        b.box('hazard_stripes', 0, 0.62, 1.095, 0.5, 0.06, 0.006);
      });
      b.pop();
      b.collide(-0.9, 0, -0.9, 0.9, H, 0.9);
    });
    // the handle (pulled down on core_shutdown)
    const hp = new THREE.Group();
    const ry = Math.atan2(-x, -79.4 - z);
    hp.position.set(x + Math.sin(ry) * 1.12, 1.25, z + Math.cos(ry) * 1.12);
    hp.rotation.y = ry;
    const hb = L.part('core:handle');
    hb.cyl('trim_steel', 0, 0, 0, 0.04, 0.22, 'x', 10);
    for (const s of [-1, 1]) hb.box('chrome', s * 0.08, 0.16, 0.0, 0.02, 0.34, 0.03);
    hb.cyl('painted_orange', 0, 0.33, 0, 0.03, 0.24, 'x', 10);
    const hg = hb.build(false);
    hg.rotation.x = 0.35;
    hp.add(hg);
    hp.userData.rooms = ['core'];
    L.root.add(hp);
    handles.push(hg);
    cableBundle(b, [x, H - 0.1, z], [x * 0.4, H - 0.05, -79.4], 3, 0.3, 0.03, 0.06, R, ['plastic_dark', 'rubber', 'plastic_dark']);
  });
  const cellsO = new THREE.Object3D(); cellsO.name = 'core_cells'; cellsO.position.set(0, 1.2, -84); L.root.add(cellsO); L.objects.set('core_cells', cellsO);
  L.interact('core_shutdown', 'lever', 'Pull the cells', 0, 1.25, -83.4, true, 2.6);
  L.ctx.events.on('interact', (e) => {
    if (e.id !== 'core_shutdown') return;
    handles.forEach((h, i) => L.tween(0.2 + i * 0.7, 0.4, (k) => { h.rotation.x = 0.35 + 2.0 * easeIn(k); }, () => L.sfx('cell_pull', CELLS[i][0], 1.2, CELLS[i][1], 1)));
  });

  // ── the pedestal ──
  b.at(0, 0, -79.4, 0, () => {
    lathe(b, 'painted_white', [[0.001, 0], [0.7, 0], [0.72, 0.08], [0.45, 0.2], [0.32, 0.9], [0.4, 1.0], [0.001, 1.02]], 0, 0, 0, 32);
    b.rbox('painted_white', 0, 1.08, 0.08, 0.8, 0.08, 0.6, 0.5, 0, 0);
    b.collide(-0.5, 0, -0.5, 0.5, 1.1, 0.5);
  });
  const ped = L.screen('core_pedestal', 'terminal_idle', 0.66, 0.42, 0, 1.135, -79.3, '+z', { text: 'ORDER 0031-H — AMENDMENT\nHEADCOUNT: 1\nCOUNTERSIGN: ____________' });
  ped.rotation.set(-1.07, 0, 0, 'YXZ');
  ped.position.set(0, 1.125, -79.3);
  const po = new THREE.Object3D(); po.name = 'core_pedestal'; po.position.set(0, 1.1, -79.4); L.root.add(po); L.objects.set('core_pedestal', po);
  L.interact('core_rewrite', 'terminal', 'Countersign the order', 0, 1.15, -79.0, true, 2.0);
  // side terminal: PATTERN LIBRARY
  b.at(-8, 0, -76.5, PI / 2, () => wallTerminal(b, 1.35));
  L.screen(null, 'terminal_idle', 0.44, 0.3, -8 + 0.126, 1.43, -76.5, '+x', { tilt: -0.18, text: 'PATTERN LIBRARY\n00  REYES, S.  (REF)' });
  L.interact('term2_core', 'terminal', 'Read terminal', -7.6, 1.4, -76.5, true, 2.2);
  b.sign('PATTERN LIBRARY', 'label', -7.97, 2.25, -76.5, 0.9, 0.12, '+x');
  b.sign('NODE 5', 'stencil', 0, 5.4, -72.21, 2.0, 0.42, '-z');

  // ── machine l2_core + vignettes ──
  let state: MachineState = 'off', bow = false, out = -1;
  const lights = L.ctx.render.lights;
  L.machines.set('l2_core', (s) => {
    state = s;
    if (s === 'frenzy') lights.setGroup('core', { flicker: 'broken' });
    else if (s === 'active') lights.setGroup('core', { flicker: 'none' });
    if (s === 'off') { for (const m of cellMats) m.emissiveIntensity = 0; ringMat.emissiveIntensity = 0; }
  });
  const target = new THREE.Vector3();
  L.ambient('core', (dt, t) => {
    if (state === 'active' || state === 'frenzy') {
      cellMats.forEach((m, i) => {
        if (out >= 0 && i < out) return;
        const k = state === 'frenzy' ? (Math.sin(t * 37 + i * 3) > 0.2 ? 2.8 : 0.4) : 2.0 + 0.4 * Math.sin(t * 1.6 + i * 2.1);
        m.emissiveIntensity = k;
      });
      ringMat.emissiveIntensity = out >= 3 ? 0 : 1.4 + 0.3 * Math.sin(t * 1.6);
    }
    // the eye hangs facing the door; after core_bow it turns to whoever is in the room
    const p = L.ctx.player?.eye;
    if (bow && p) {
      target.set(p.x, eyePivot.position.y, p.z);
      const want = Math.atan2(target.x - eyePivot.position.x, target.z - eyePivot.position.z);
      let d = want - eyePivot.rotation.y;
      while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI;
      eyePivot.rotation.y += d * Math.min(1, dt * 1.2);
      eyePivot.rotation.x += (Math.atan2(eyePivot.position.y - p.y, Math.hypot(p.x - eyePivot.position.x, p.z - eyePivot.position.z)) * 0.6 - eyePivot.rotation.x) * Math.min(1, dt);
    } else eyePivot.position.y = 3.7 + Math.sin(t * 0.7) * 0.04;
  });
  L.vignette('core_bow', () => {
    bow = true;
    L.sfx('glitch', 0, 3.5, -79.4, 0.6);
    try { L.ctx.render.post.glitch(0.35); } catch { /* post */ }
  });
  L.vignette('core_cells_out', () => {
    out = 0;
    CELLS.forEach(([x, z], i) => L.after(i * 1.4, () => {
      out = i + 1;
      L.tween(0, 0.5, (k) => { cellMats[i].emissiveIntensity = 2.2 * (1 - easeInOut(k)); });
      L.sfx('power_down', x, 3, z, 0.8, 0.9 - i * 0.1);
      if (i === 2) {
        L.after(0.4, () => {
          lights.setGroup('core', { enabled: false });
          lights.setGroup('core_battery', { enabled: true });
          ringMat.emissiveIntensity = 0;
          for (const n of ['core_wall_1', 'core_wall_2', 'core_wall_3', 'core_wall_4', 'core_eye']) { const m = L.screens.get(n); if (m) L.ctx.materials.setScreen(m, 'static'); }
          L.after(1.5, () => { for (const n of ['core_wall_1', 'core_wall_2', 'core_wall_3', 'core_wall_4', 'core_eye']) { const m = L.screens.get(n); if (m) m.emissiveIntensity = 0; } });
        });
      }
    }));
  });

  buildLift(L);
}

function buildLift(L: LevelBuild) {
  const b = L.builder('lift');
  const Hh = 3.0;
  L.room('lift', 'SERVICE LIFT', -2, 2, -93, -88, Hh);
  floorSlab(b, 'floor_plate', -2, -93, 2, -88, [], 'metal', 0.3);
  ceilingSlab(b, -2.2, -93.2, 2.2, -88, Hh, 'trim_steel');
  const st = { h: Hh, t: 0.2, style: 'plain' as const, trayY: 0, features: 0, bay: 1.2 };
  wallFace(b, { ...st, n: '-z', plane: -88.2, from: -2, to: 2, openings: [{ c: 0, w: 1.6, h: 2.4 }], seed: 296 });
  wallFace(b, { ...st, n: '+z', plane: -93, from: -2, to: 2, seed: 297 });
  wallFace(b, { ...st, n: '+x', plane: -2, from: -93, to: -88.2, seed: 298 });
  wallFace(b, { ...st, n: '-x', plane: 2, from: -93, to: -88.2, seed: 299 });
  // the cab interior (dynamic, so it can rattle)
  const cb = L.part('lift:cab');
  for (const x of [-1.85, 1.85]) handrail(cb, 'chrome', [[x, 0, -88.7], [x, 0, -92.6]], 1.0, 1.4, false);
  handrail(cb, 'chrome', [[-1.85, 0, -92.75], [1.85, 0, -92.75]], 1.0, 1.4, false);
  cb.box('hazard_stripes', 0, 0.003, -88.55, 1.8, 0.006, 0.18);
  for (const [x, f] of [[-1.98, '+x'], [1.98, '-x']] as const) for (let z = -88.8; z > -92.9; z -= 0.8) panelOn(cb, 'trim_steel', x, 1.5, z - 0.4, 0.72, 2.6, f, 0.012, 0.02);
  // control panel (east wall)
  cb.box('painted_dark', 1.93, 1.3, -89.4, 0.1, 0.5, 0.3);
  cb.cyl('emissive_green', 1.87, 1.15, -89.4, 0.035, 0.03, 'x', 12);
  const cab = cb.build(false);
  cab.name = 'lift_cab';
  cab.userData.rooms = ['lift'];
  for (const m of cab.children) m.castShadow = true;
  L.root.add(cab);
  L.objects.set('lift_cab', cab);
  L.screen('lift_panel', 'terminal_idle', 0.22, 0.16, 1.875, 1.42, -89.4, '-x', { text: 'SERVICE LIFT\nUP' });
  L.interact('lift_button', 'button', 'Call lift', 1.75, 1.15, -89.4, true, 1.8);
  const lamp = L.spot('lift', 0, Hh - 0.15, -90.5, 0, 0, -90.5, 0xeef4ff, 26, 5, 1.2, { cast: true });
  const lm = L.glow(lamp, 'emissive_white');
  b.detail(() => b.box(lm, 0, Hh - 0.03, -90.5, 1.4, 0.03, 1.4));
  let state: MachineState = 'off';
  L.machines.set('l2_lift', (s) => { state = s; });
  L.ambient('lift', (_dt, t) => {
    if (state !== 'active' && state !== 'frenzy') { if (cab.position.y !== 0) cab.position.set(0, 0, 0); return; }
    const k = state === 'frenzy' ? 2 : 1;
    cab.position.set(Math.sin(t * 53) * 0.002 * k, Math.sin(t * 41) * 0.004 * k, 0);
    lamp.intensityScale = 0.85 + 0.15 * Math.sin(t * 13);
  });
}
