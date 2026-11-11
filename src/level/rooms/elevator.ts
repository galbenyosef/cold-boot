/**
 * FREIGHT ELEVATOR — cab x -2.5…2.5, z -63…-58, h 3.2. A cage inside a much larger shaft.
 * `setMachine('elevator','active')` fakes the descent: the shaft (ribs, light strips, counterweight)
 * scrolls upward past the grated cab, shaft lights streak by, the cab rattles. The cab never moves.
 */
import * as THREE from 'three';
import { rng } from '../builder';
import type { LevelBuild, MachineState } from '../context';
import { cagePanel, floorSlab, grate, handrail, ibeam, panel } from '../kit';

const PI = Math.PI;
const PERIOD = 4;

export function buildElevator(L: LevelBuild) {
  const R = rng(1010);
  const H = 3.2;
  L.room('elevator', 'FREIGHT ELEVATOR', -2.5, 2.5, -63, -58, H);
  const st = L.builder('elevator_static');

  // cab floor: plate with a central grated section over the open shaft
  floorSlab(st, 'floor_plate', -2.56, -63.06, 2.56, -58, [[-1.2, -62.0, 1.2, -59.4]], 'metal', 0.18);
  grate(st, -1.2, -62.0, 1.2, -59.4, 0, 0.8);
  // colliders for the cage
  st.collide(-2.62, 0, -63.1, -2.5, H, -58.2); st.collide(2.5, 0, -63.1, 2.62, H, -58.2); st.collide(-2.6, 0, -63.12, 2.6, H, -63);
  st.collide(-2.6, H, -63.1, 2.6, H + 0.1, -58, 'metal', false);

  // ── the cab (dynamic so it can rattle) ──
  const cb = L.part('elevator_cab');
  const cg = L.doubleSided('floor_grate');
  for (const x of [-2.53, 2.53]) for (const z of [-63.03, -58.26]) cb.box('painted_yellow', x, H / 2, z, 0.12, H, 0.12);
  for (const x of [-2.53, 2.53]) cb.box('painted_yellow', x, H / 2, -60.65, 0.1, H, 0.1);
  cb.box('painted_yellow', 0, H / 2, -63.03, 0.1, H, 0.1);
  for (const y of [0.16, 1.1, H - 0.06]) {
    cb.box('trim_steel', -2.53, y, -60.65, 0.08, y < 0.2 ? 0.32 : 0.08, 4.7).box('trim_steel', 2.53, y, -60.65, 0.08, y < 0.2 ? 0.32 : 0.08, 4.7);
    cb.box('trim_steel', 0, y, -63.03, 5.0, y < 0.2 ? 0.32 : 0.08, 0.08);
  }
  cb.box('trim_steel', 0, H - 0.06, -58.26, 5.0, 0.12, 0.1);
  // mesh walls
  cb.push(-2.5, 0, -63, 0); cagePanel(cb, cg, 0, 0.3, 2.5, H - 0.1, 0, 0.03); cagePanel(cb, cg, 2.5, 0.3, 5.0, H - 0.1, 0, 0.03); cb.pop();
  for (const x of [-2.53, 2.53]) { cb.push(x, 0, -58.3, PI / 2); cagePanel(cb, cg, 0, 0.3, 2.35, H - 0.1, 0, 0.03); cagePanel(cb, cg, 2.35, 0.3, 4.7, H - 0.1, 0, 0.03); cb.pop(); }
  // roof: grate + cross beams + sheave + hoist cables
  cb.quad(cg, 0, H, -60.65, 5.0, 4.7, '-y', 0, 'box');
  for (const z of [-59.4, -60.65, -61.9]) ibeam(cb, 'painted_yellow', 'x', 0, H + 0.1, z, 5.1, 0.12, 0.2);
  ibeam(cb, 'painted_yellow', 'z', 0, H + 0.3, -60.65, 4.8, 0.16, 0.24);
  cb.cyl('steel_raw', 0, H + 0.62, -60.65, 0.3, 0.14, 'x', 16);
  for (const dx of [-0.09, -0.03, 0.03, 0.09]) cb.rod('steel_raw', dx, H + 0.6, -60.65 - 0.3, dx, H + 14, -60.65 - 0.3, 0.012, 4);
  // interior: handrails, hazard edge at the gate, load plate, toe guards
  handrail(cb, 'painted_yellow', [[-2.38, 0, -62.9], [-2.38, 0, -58.5]], 1.0, 1.5, false);
  handrail(cb, 'painted_yellow', [[2.38, 0, -58.5], [2.38, 0, -61.6]], 1.0, 1.5, false);
  handrail(cb, 'painted_yellow', [[-2.38, 0, -62.9], [1.2, 0, -62.9]], 1.0, 1.5, false);
  cb.box('hazard_stripes', 0, 0.003, -58.42, 4.8, 0.006, 0.3);
  cb.box('hazard_stripes', 0, 0.003, -62.15, 2.7, 0.006, 0.14).box('hazard_stripes', 0, 0.003, -59.25, 2.7, 0.006, 0.14);
  // control pedestal (rear right), angled at whoever walks in
  cb.push(1.85, 0, -62.35, -0.5);
  cb.box('painted_dark', 0, 0.5, 0, 0.5, 1.0, 0.36);
  cb.box('trim_steel', 0, 0.03, 0, 0.62, 0.06, 0.48);
  cb.rbox('painted_dark', 0, 1.1, 0.0, 0.56, 0.3, 0.42, 0.5, 0, 0);
  cb.rbox('trim_steel', 0, 1.14, 0.05, 0.5, 0.02, 0.38, 0.5 - PI / 2 + PI / 2, 0, 0);
  cb.pop();
  const cab = cb.build(false);
  cab.name = 'elevator_cab';
  for (const m of cab.children as THREE.Mesh[]) m.castShadow = true;
  L.root.add(cab);
  L.objects.set('elevator_cab', cab);
  // pedestal top: screen + button (children of the cab so they rattle with it)
  const ped = new THREE.Group();
  ped.position.set(1.85, 0, -62.35); ped.rotation.y = -0.5;
  cab.add(ped);
  const scr = L.screen('elev_panel', 'terminal_alert', 0.3, 0.2, -0.07, 1.2, 0.13, '+z', { text: 'NO POWER', tilt: -(PI / 2 - 0.5), parent: ped });
  scr.position.set(-0.08, 1.185, 0.155);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 14), L.ctx.materials.get('emissive_red'));
  btn.position.set(0.16, 1.2, 0.17); btn.rotation.x = 0.5;
  const btnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 14), L.ctx.materials.get('painted_yellow'));
  btnBase.position.set(0.16, 1.19, 0.165); btnBase.rotation.x = 0.5;
  ped.add(btn, btnBase);
  const bw = ped.localToWorld(new THREE.Vector3(0.16, 1.2, 0.17));
  st.collide(1.55, 0, -62.65, 2.15, 1.2, -62.05);
  L.interact('elev_button', 'button', 'Call elevator: SURFACE', 1.91, 1.2, -62.12, false, 2.2);
  void bw;
  L.ctx.events.on('interact', (e) => { if (e.id === 'elev_button') btn.position.y = 1.19; });

  // ── the shaft: periodic walls (wrap every PERIOD metres) ──
  const sh = L.part('elevator_shaft');
  const X0 = -3.35, X1 = 3.35, Z0 = -63.85, Z1 = -58.2, Y0 = -14, Y1 = 18;
  const wall = 'wall_panel_dark';
  sh.box(wall, X0 - 0.1, (Y0 + Y1) / 2, (Z0 + Z1) / 2, 0.2, Y1 - Y0, Z1 - Z0 + 0.4);
  sh.box(wall, X1 + 0.1, (Y0 + Y1) / 2, (Z0 + Z1) / 2, 0.2, Y1 - Y0, Z1 - Z0 + 0.4);
  sh.box(wall, 0, (Y0 + Y1) / 2, Z0 - 0.1, X1 - X0, Y1 - Y0, 0.2);
  // front wall beside / above the gate (the gate opening itself is closed by the scrolling "sill" below)
  for (const s of [-1, 1]) sh.box(wall, s * 2.6, (Y0 + Y1) / 2, Z1 + 0.1, 1.5, Y1 - Y0, 0.2);
  const strips: THREE.Material[] = [];
  for (let y = Y0; y < Y1; y += 1) {
    const major = Math.round(y - Y0) % PERIOD === 0;
    const hh = major ? 0.22 : 0.1, d = major ? 0.16 : 0.08;
    sh.box('trim_steel', X0 + d / 2, y, (Z0 + Z1) / 2, d, hh, Z1 - Z0);
    sh.box('trim_steel', X1 - d / 2, y, (Z0 + Z1) / 2, d, hh, Z1 - Z0);
    sh.box('trim_steel', 0, y, Z0 + d / 2, X1 - X0, hh, d);
    for (const s of [-1, 1]) sh.box('trim_steel', s * 2.6, y, Z1 - d / 2, 1.5, hh, d);
    if (major) {
      sh.box('hazard_stripes', 0, y + 0.5, Z0 + 0.012, 1.6, 0.25, 0.02);
      for (const s of [-1, 1]) sh.box('painted_dark', s * 1.7, y + 2, Z0 + 0.06, 0.5, 1.2, 0.12);
    }
  }
  // guide rails, cable runs (continuous → look static while scrolling, as they should)
  for (const s of [-1, 1]) {
    ibeam(sh, 'steel_raw', 'y', s * 3.05, (Y0 + Y1) / 2, -60.65, Y1 - Y0, 0.14, 0.16, 0.02, 0.014, true);
    for (let i = 0; i < 4; i++) sh.rod('rubber', s * 3.25, Y0, -59.2 - i * 0.09, s * 3.25, Y1, -59.2 - i * 0.09, 0.025, 5);
    sh.box('trim_steel', s * 3.28, (Y0 + Y1) / 2, -62.4, 0.08, Y1 - Y0, 0.5);
  }
  for (const x of [-2.9, -2.2]) sh.box('steel_raw', x, (Y0 + Y1) / 2, Z0 + 0.3, 0.06, Y1 - Y0, 0.06); // counterweight rails
  const shaft = sh.build(false);
  shaft.name = 'elevator_shaft';
  L.root.add(shaft);

  // light strips on the back wall, one per period, bound to real lights that wrap with the scroll
  const strip = new THREE.BoxGeometry(0.08, 1.2, 0.05);
  const lights: { h: ReturnType<LevelBuild['point']>; base: number }[] = [];
  let glow: THREE.MeshStandardMaterial | null = null;
  for (let k = -1; k <= 1; k++) {
    const base = k * PERIOD + 2;
    const h = L.point('elevator', 0, base, Z0 + 0.5, 0xffb060, 26, 7.5, { enabled: false, priority: 2 });
    lights.push({ h, base });
    if (!glow) glow = L.glow(h, 'emissive_amber', 1.3);
  }
  for (let y = Y0 + 2; y < Y1; y += PERIOD) for (const s of [-1, 1]) {
    const m = new THREE.Mesh(strip, glow!);
    m.position.set(s * 1.7, y, Z0 + 0.14);
    shaft.add(m);
  }
  void strips;

  // the sill: a long wall that rises across the gate opening as the cab "descends" (never wraps)
  const sb = L.part('elevator_sill');
  const SL = 260;
  sb.box(wall, 0, -SL / 2 - 0.06, -57.94, 3.04, SL, 0.06);
  sb.cast = false;
  for (let y = -1; y > -SL; y -= 1) sb.box('trim_steel', 0, y, -57.975, 3.04, Math.round(-y) % PERIOD === 0 ? 0.22 : 0.1, 0.03);
  for (let y = -3; y > -SL; y -= 2 * PERIOD) sb.box('hazard_stripes', 0, y, -57.985, 2.4, 0.3, 0.012);
  const sill = sb.build(false);
  L.root.add(sill);

  // counterweight (passes upward every so often during the descent)
  const wb = L.part('elevator_cw');
  wb.box('painted_dark', 0, 0, 0, 0.9, 2.6, 0.3);
  for (let i = 0; i < 8; i++) wb.box('rust', 0, -1.1 + i * 0.3, 0.02, 0.8, 0.26, 0.3);
  wb.box('hazard_stripes', 0, 1.36, 0, 0.94, 0.12, 0.34).box('hazard_stripes', 0, -1.36, 0, 0.94, 0.12, 0.34);
  for (const dx of [-0.2, 0.2]) wb.rod('steel_raw', dx, 1.4, 0, dx, 30, 0, 0.012, 4);
  const cw = wb.build(false);
  cw.position.set(-2.55, 9.5, Z0 + 0.3);
  L.root.add(cw);

  // cab lamp + panel glow
  const lamp = L.spot('elevator', 0, H - 0.2, -60.4, 0, 0, -60.6, 0xffd6a0, 34, 6, 1.1, { enabled: false, cast: true, flicker: 'fluorescent' });
  const lampMat = L.glow(lamp, 'emissive_warm');
  const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.2), lampMat);
  lampMesh.position.set(0, H - 0.1, -60.4);
  cab.add(lampMesh);
  L.point('elevator', 1.75, 1.35, -62.1, 0xff4020, 1.2, 2.6, { flicker: 'pulse' });
  // shaft uplight so the void below reads when powered
  L.spot('elevator', 0, -1.2, -60.6, 0, -12, -60.6, 0xff8a40, 30, 12, 0.8, { enabled: false, vol: true });

  // ── machine ──
  let state: MachineState = 'off', speed = 0, dist = 0, cwY = 9.5, cwTimer = 3;
  L.machines.set('elevator', (s) => { state = s; });
  L.updaters.push((dt, t) => {
    const target = state === 'active' ? 6.5 : state === 'frenzy' ? 11 : 0;
    if (speed === 0 && target === 0) {
      if (state === 'idle') { cab.position.y = Math.sin(t * 1.3) * 0.002; }
      return;
    }
    speed += (target - speed) * Math.min(1, dt * 0.6);
    if (target === 0 && speed < 0.02) { speed = 0; cab.position.set(0, 0, 0); return; }
    dist += speed * dt;
    const off = dist % PERIOD;
    shaft.position.y = off;
    sill.position.y = Math.min(dist, SL - 6);
    for (let i = 0; i < lights.length; i++) lights[i].h.position.y = lights[i].base + off;
    // counterweight pass
    cwTimer -= dt;
    if (cwTimer <= 0 && cwY > 17) { cwY = -13; cwTimer = 7 + (Math.sin(t * 3.7) + 1) * 3; }
    if (cwY <= 17) cwY += speed * 2 * dt;
    cw.position.y = cwY;
    // rattle
    const k = (speed / 6.5) * (state === 'frenzy' ? 2.2 : 1);
    cab.position.set(Math.sin(t * 61) * 0.0035 * k, Math.sin(t * 47) * 0.005 * k + Math.sin(t * 5.1) * 0.004 * k, Math.sin(t * 53) * 0.003 * k);
    cab.rotation.z = Math.sin(t * 7.3) * 0.0015 * k;
  });

  // elev_gate_rattle: something heavy hits the cage gate from the shaft side — once
  L.vignette('elev_gate_rattle', () => {
    const d = L.doors.get('d_elev');
    L.sfx('gate_rattle', 0, 1.5, -58, 1, 1);
    d?.shake(0.04, 1.5);
    const p = new THREE.Vector3();
    for (const x of [-1.2, 0, 1.1]) L.ctx.fx.smoke(p.set(x, 3.0, -57.9), { count: 3, size: 0.3, color: 0x8a8880, rise: -0.6, life: 1.8 });
    // the cab takes the blow too
    let t = 0;
    L.sim((dt) => { t += dt; const k = Math.exp(-t * 3.5); cab.position.z = Math.sin(t * 38) * 0.012 * k; cab.rotation.x = Math.sin(t * 31) * 0.003 * k; if (t > 1.6) { cab.position.z = 0; cab.rotation.x = 0; return false; } return true; });
    L.after(0.42, () => d?.shake(0.015, 0.9));
  });

  // signs
  st.sign('12 t', 'stencil', 0, 0.004, -62.5, 1.0, 0.4, '+y');
  void panel; void R;
}
