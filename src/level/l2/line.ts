/**
 * LINE TWO — the line itself (east side of the hall): belt, loading station, the enclosed fitting tunnel
 * (a real machine with a mouth, presses and reaching arms), exit apron, the walkway gate, the overhead
 * hook conveyor with units mid-process, and the machines / vignettes that drive all of it:
 *   l2_line   — off = held; active = belt runs 1.6 m/s south and carries whoever stands on it, hooks travel
 *   l2_tunnel — idle = slow work cycles; active = arms reach for a player on the belt (crouch or shoot the joint)
 */
import * as THREE from 'three';
import { rng, type Builder, type Mat, type Rng } from '../builder';
import type { LevelBuild, MachineState } from '../context';
import { bolts4, cable, cableBundle, cagePanel, channel, handrail, hazardStrip, hose, ibeam, panelOn, pipe, valve } from '../kit';
import { Conveyor, LoopPath, skinParts, type HookLoad } from '../machines';
import { beacon, workLight } from '../structure';
import { easeIn, easeInOut, easeOut } from '../ambient';
import { scrollMat } from './kit2';

const PI = Math.PI;
// The belt starts at an infeed south of the fitting-bay door (the floor north of it is open, so the east
// side of the hall — and the fitting bays — can be reached on foot and by nav).
export const BELT = { x0: 4.0, x1: 6.0, y: 0.55, zN: -36.5, zS: -63.5, speed: 1.6 };
export const TUN = { x0: 2.5, x1: 7.5, zN: -50, zS: -62, roof: 3.6, inner: 3.25 };
const LOAD = { zN: -42, zS: -47, deckX0: 2.15 };
// just south of the booth glass and the tunnel mouth: the glass stays on the north (load) side
const GATE_Z = -50.35;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _carry = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export function buildLine(L: LevelBuild, b: Builder) {
  const R = rng(2401);
  const ctx = L.ctx;
  beltAndFrame(L, b, R);
  const belt = beltSurface(L);
  loadingStation(L, b, R);
  const tunnel = buildTunnel(L, b, R);
  apron(L, b);
  const gate = walkwayGate(L, b);
  const conv = hooks(L, b);

  // ── l2_line ──
  let state: MachineState = 'off';
  let speed = 0, jerk = 0, carrying = false, pin = 0;
  L.machines.set('l2_line', (s) => {
    const was = state;
    state = s;
    conv.state = s === 'off' ? 'off' : s;
    if ((s === 'active' || s === 'frenzy') && was !== 'active' && was !== 'frenzy') { jerk = 0.45; L.sfx('belt_start', 5, 1, -40, 1); }
    gate.set(s === 'active' || s === 'frenzy');
  });
  tunnel.onHit = () => { pin = 0.7; };
  L.updaters.push((dt) => {
    const target = state === 'active' ? BELT.speed : state === 'frenzy' ? BELT.speed * 1.5 : state === 'idle' ? 0.2 : 0;
    // the belt does not glide up to speed: it jerks, slips back a hair, then pulls
    if (jerk > 0) { jerk -= dt; speed = jerk > 0.3 ? 2.4 : jerk > 0.15 ? -0.3 : target * 0.6; }
    else speed += (target - speed) * Math.min(1, dt * (target > speed ? 1.6 : 2.5));
    if (Math.abs(speed) < 1e-3 && target === 0) speed = 0;
    belt.offset.value += speed * dt;
    // carry whoever stands on it
    const pl = ctx.player;
    if (!pl) return;
    const p = pl.position;
    const on = speed !== 0 && p.x > BELT.x0 - 0.05 && p.x < BELT.x1 + 0.05 && p.z < BELT.zN && p.z > BELT.zS - 0.2 && p.y > BELT.y - 0.15 && p.y < BELT.y + 0.3;
    if (pin > 0) pin -= dt;
    if (on) { pl.setCarry?.(_carry.set(0, 0, pin > 0 ? 0 : -speed)); carrying = true; }
    else if (carrying) { pl.setCarry?.(null); carrying = false; }
  });

  // line_start: sirens, beacons, the belt jerks and runs, hooks advance, the tunnel lights strobe
  L.vignette('line_start', () => {
    try {
      const siren = ctx.audio.loop('siren_loop', { position: new THREE.Vector3(0, 6, -46), volume: 0.9 });
      L.after(9, () => siren.stop(3));
    } catch { /* audio */ }
    ctx.render.lights.setGroup('line_emergency', { enabled: true });
    L.after(0.8, () => L.setMachine('l2_line', 'active'));
    L.after(1.6, () => { ctx.render.lights.setGroup('tunnel', { enabled: true }); L.setMachine('l2_tunnel', 'active'); });
    L.after(12, () => ctx.render.lights.setGroup('line_emergency', { enabled: false }));
  });
  // hall_hooks_sway: every hanging unit swings once, in phase, as if the building breathed
  L.vignette('hall_hooks_sway', () => { L.sfx('metal_groan', 5, 6.5, -42, 0.7, 0.6); conv.notch(); L.after(0.25, () => conv.notch()); }, true);
  L.ambient('line', (dt, t) => conv.update(dt, t));
  void tunnel;
}

// ───────────────────────────────────────────────────────────── belt

function beltAndFrame(L: LevelBuild, b: Builder, R: Rng) {
  const { x0, x1, y, zN, zS } = BELT;
  const len = zN - zS, zc = (zN + zS) / 2;
  // side channels (rails the belt edges run in), legs every 1.6 m, cross members
  for (const s of [-1, 1]) {
    const x = s < 0 ? x0 - 0.08 : x1 + 0.08;
    channel(b, 'painted_yellow', 'z', x, y - 0.1, zc, len, 0.16, 0.22, 0.014);
    b.box('trim_steel', x, y + 0.02, zc, 0.2, 0.025, len);
    b.detail(() => b.box('hazard_stripes', x + s * 0.082, y - 0.1, zc, 0.004, 0.12, len));
    for (let z = zN - 0.4; z >= zS; z -= 1.6) {
      if (z < TUN.zN + 0.2 && z > TUN.zS - 0.2) continue; // inside the tunnel the machine carries it
      b.box('painted_dark', x, (y - 0.2) / 2, z, 0.1, y - 0.2, 0.1);
      b.box('painted_dark', x, 0.015, z, 0.24, 0.03, 0.24);
      b.detail(() => { b.inst('bolt', x - 0.08, 0.035, z - 0.08, -PI / 2, 0, 0, 2); b.inst('bolt', x + 0.08, 0.035, z + 0.08, -PI / 2, 0, 0, 2); });
    }
  }
  b.detail(() => {
    for (let z = zN - 0.4; z >= zS; z -= 1.6) b.box('painted_dark', (x0 + x1) / 2, 0.22, z, x1 - x0 + 0.2, 0.06, 0.06);
    // return run of the belt underneath, idlers
    b.box('conveyor_belt', (x0 + x1) / 2, 0.3, zc, x1 - x0 - 0.1, 0.012, len);
    for (let z = zN - 0.8; z >= zS; z -= 3.2) b.cyl('steel_raw', (x0 + x1) / 2, 0.28, z, 0.04, x1 - x0, 'x', 8);
    // drive motors + gearboxes along the west side, cable tray under the frame
    for (const z of [-38.6, -64.6]) {
      b.box('painted_dark', x0 - 0.42, 0.32, z, 0.5, 0.36, 0.42);
      b.cyl('robot_joint', x0 - 0.42, 0.32, z + 0.28, 0.12, 0.16, 'z', 12);
      b.cyl('painted_yellow', x0 - 0.42, 0.32, z - 0.27, 0.15, 0.14, 'z', 12);
      b.box('steel_raw', x0 - 0.18, 0.4, z, 0.06, 0.2, 0.08);
      hose(b, 'rubber', [[x0 - 0.42, 0.52, z], [x0 - 0.6, 0.6, z + 0.6], [x0 - 0.7, 0.03, z + 1.4]], 0.02, 5);
    }
    b.box('trim_steel', x1 + 0.25, 0.25, zc, 0.3, 0.02, len - 1);
    for (let i = 0; i < 3; i++) b.rod(i % 2 ? 'rubber' : 'plastic_dark', x1 + 0.15 + i * 0.08, 0.28, zN - 0.5, x1 + 0.15 + i * 0.08, 0.28, zS + 0.5, 0.02, 5);
  });
  // head drum (north) and tail drum (south) with guards
  for (const [z, s] of [[zN, 1], [zS, -1]] as const) {
    b.cyl('steel_raw', (x0 + x1) / 2, y - 0.17, z, 0.17, x1 - x0 + 0.04, 'x', 16);
    b.box('painted_yellow', (x0 + x1) / 2, y - 0.17, z + s * 0.2, x1 - x0 + 0.36, 0.42, 0.06);
    b.detail(() => { b.box('hazard_stripes', (x0 + x1) / 2, y - 0.17, z + s * 0.235, x1 - x0 + 0.36, 0.3, 0.004); });
    for (const sx of [x0 - 0.12, x1 + 0.12]) b.box('painted_dark', sx, (y - 0.1) / 2, z + s * 0.1, 0.12, y - 0.1, 0.3);
  }
  // the north end: an infeed stop, the line's name
  b.at((x0 + x1) / 2, 0, zN + 0.8, 0, () => {
    b.box('painted_yellow', 0, 0.55, 0, 2.6, 1.1, 0.25);
    b.detail(() => { b.box('hazard_stripes', 0, 0.55, 0.128, 2.6, 0.9, 0.004); b.sign('LINE 2 — INFEED', 'label', 0, 1.25, 0.13, 1.4, 0.16, '+z', 0, true); b.sign('UNITS ARE LOWERED HERE', 'warning', 0, 0.5, 0.13, 1.4, 0.18, '+z', 0, true); });
    b.collide(-1.3, 0, -0.13, 1.3, 1.1, 0.13);
  });
  // collider: the belt top (walkable) along its whole length
  b.collide(x0 - 0.16, 0, zS, x1 + 0.16, y, zN, 'rubber', true);
  // east guard rail along the whole run (the line sits against the east side of the hall)
  handrail(b, 'painted_yellow', [[x1 + 0.12, y, zN - 0.2], [x1 + 0.12, y, TUN.zN + 0.3]], 1.0, 1.6, false);
  b.collide(x1 + 0.08, y, TUN.zN, x1 + 0.2, y + 1.1, zN);
  // west rail north of the loading station (the belt is not a walkway)
  handrail(b, 'painted_yellow', [[x0 - 0.12, y, zN - 0.2], [x0 - 0.12, y, LOAD.zN + 0.1]], 1.0, 1.6, false);
  b.collide(x0 - 0.2, y, LOAD.zN, x0 - 0.08, y + 1.1, zN);
  // between the loading station and the tunnel mouth: high guards both sides
  for (const x of [x0 - 0.12, x1 + 0.12]) handrail(b, 'painted_yellow', [[x, y, LOAD.zS - 0.1], [x, y, TUN.zN + 0.2]], 1.2, 1.2, true);
  b.collide(x0 - 0.2, y, TUN.zN, x0 - 0.08, y + 1.3, LOAD.zS);
  void R;
}

function beltSurface(L: LevelBuild): { offset: { value: number } } {
  const { mat, offset } = scrollMat(L, 'conveyor_belt', 'v');
  const p = L.part('line:belt');
  p.box(mat, (BELT.x0 + BELT.x1) / 2, BELT.y - 0.015, (BELT.zN + BELT.zS) / 2, BELT.x1 - BELT.x0, 0.03, BELT.zN - BELT.zS);
  const g = p.build(false);
  for (const m of g.children) { m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; }
  g.name = 'line_belt';
  L.root.add(g);
  return { offset };
}

// ───────────────────────────────────────────────────────────── loading station

function loadingStation(L: LevelBuild, b: Builder, R: Rng) {
  const y = BELT.y, x0 = LOAD.deckX0, x1 = BELT.x0 - 0.16, zN = LOAD.zN, zS = LOAD.zS;
  // deck (walkable, same height as the belt) and steps down to the walkway
  b.bx('painted_dark', x0, 0, zS, x1, y - 0.03, zN);
  b.bx('floor_plate', x0, y - 0.03, zS, x1, y, zN);
  b.collide(x0, 0, zS, x1, y, zN, 'metal');
  const steps = 4, rise = y / steps;
  for (let i = 0; i < steps; i++) {
    const sx0 = x0 - (steps - i) * 0.28;
    b.bx('floor_plate', sx0, 0, -45.6, sx0 + 0.28, (i + 1) * rise, -43.4);
    b.detail(() => b.bx('hazard_stripes', sx0, (i + 1) * rise - 0.004, -45.6, sx0 + 0.05, (i + 1) * rise + 0.002, -43.4));
    b.collide(sx0, 0, -45.6, sx0 + 0.28, (i + 1) * rise, -43.4, 'metal', false);
  }
  handrail(b, 'painted_yellow', [[x0 + 0.05, y, zN - 0.05], [x0 + 0.05, y, -43.45]], 1.0, 1.4, true);
  handrail(b, 'painted_yellow', [[x0 + 0.05, y, -45.55], [x0 + 0.05, y, zS + 0.05]], 1.0, 1.4, true);
  handrail(b, 'painted_yellow', [[x0 + 0.05, y, zS + 0.05], [x1, y, zS + 0.05]], 1.0, 1.4, true);
  handrail(b, 'painted_yellow', [[x0 + 0.05, y, zN - 0.05], [x1, y, zN - 0.05]], 1.0, 1.4, true);
  b.collide(x0, y, zN - 0.1, x0 + 0.1, y + 1.05, -43.45); b.collide(x0, y, zS, x0 + 0.1, y + 1.05, -45.55);
  b.collide(x0, y, zS, x1, y + 1.05, zS + 0.1); b.collide(x0, y, zN - 0.1, x1, y + 1.05, zN);
  b.detail(() => { hazardStrip(b, x1 - 0.12, zS + 0.1, x1, zN - 0.1, y); });
  b.sign('LOADING — UNITS ONLY', 'stencil', (x0 + x1) / 2, y + 0.004, -44.5, 1.5, 0.25, '+y', -PI / 2);
  // operator pedestal on the deck: e-stop, a screen, the cycle buttons
  b.at(x0 + 0.45, y, -46.3, PI / 2 + 0.4, () => {
    b.box('painted_dark', 0, 0.5, 0, 0.42, 1.0, 0.32);
    b.rbox('trim_steel', 0, 1.06, 0.03, 0.5, 0.04, 0.42, 0.45, 0, 0);
    b.detail(() => {
      b.cyl('emissive_red', -0.12, 1.12, 0.05, 0.045, 0.05, 'y', 12);
      b.cyl('painted_yellow', -0.12, 1.09, 0.05, 0.07, 0.02, 'y', 12);
      for (let i = 0; i < 3; i++) b.inst(i ? 'led_amber' : 'led_green', 0.05 + i * 0.05, 1.1, 0.02 + i * 0.02, -0.45 - PI / 2);
      b.sign('CYCLE', 'label', 0.1, 1.11, 0.12, 0.14, 0.04, '+y');
    });
    b.collide(-0.21, 0, -0.16, 0.21, 1.1, 0.16);
  });
  // loading arch over the belt: scanner bars and clamps
  const az = -44.6;
  b.at((BELT.x0 + BELT.x1) / 2, y, az, 0, () => {
    for (const s of [-1, 1]) {
      ibeam(b, 'painted_yellow', 'y', s * 1.35, 1.55, 0, 3.1, 0.22, 0.26, 0.02, 0.014);
      b.box('painted_dark', s * 1.35, 0.03, 0, 0.5, 0.06, 0.5);
      b.detail(() => { b.box('hazard_stripes', s * 1.35, 0.8, 0.135, 0.22, 1.2, 0.004); for (let i = 0; i < 4; i++) b.inst('bolt', s * 1.35 + (i % 2 ? 0.18 : -0.18), 0.065, i < 2 ? 0.18 : -0.18, -PI / 2, 0, 0, 2); });
      // clamp arms folded against the posts
      b.rbox('robot_joint', s * 1.12, 1.4, 0, 0.12, 0.7, 0.14, 0, 0, s * 0.25);
      b.box('painted_dark', s * 1.0, 1.05, 0, 0.18, 0.18, 0.22);
    }
    b.box('painted_yellow', 0, 3.15, 0, 3.0, 0.32, 0.4);
    b.detail(() => {
      b.box('painted_dark', 0, 2.97, 0, 2.5, 0.06, 0.25);
      b.sign('LOAD STATION 2', 'label', 0, 3.15, 0.205, 1.2, 0.16, '+z');
      b.sign('LOAD STATION 2', 'label', 0, 3.15, -0.205, 1.2, 0.16, '-z');
      cableBundle(b, [1.3, 3.3, 0], [2.4, 3.5, 0.3], 3, 0.15, 0.015, 0.04, R);
    });
  });
  const scan = L.spot('line', (BELT.x0 + BELT.x1) / 2, y + 2.8, az, 5, y, az, 0xbfe2ff, 38, 4.5, 0.75, { priority: 2, penumbra: 0.3 });
  const sg = L.glow(scan, 'emissive_cyan', 1.4);
  b.detail(() => b.box(sg, (BELT.x0 + BELT.x1) / 2, y + 2.93, az, 2.2, 0.02, 0.06));
  const o = new THREE.Object3D(); o.name = 'line_load_station'; o.position.set(3.2, y, -44.5); L.root.add(o); L.objects.set('line_load_station', o);
  workLight(b, L, 'line', 0.4, -41.2, Math.atan2(-(4 - 0.4), -(-45 + 41.2)), { intensity: 120, distance: 10, angle: 0.65, cast: true, vol: true, pitch: 0.3, height: 2.1 });
}

// ───────────────────────────────────────────────────────────── the fitting tunnel

interface TunnelArm {
  base: THREE.Bone; sh: THREE.Bone; el: THREE.Bone; wr: THREE.Bone;
  side: 1 | -1; z: number; bx: number; by: number;
  phase: 'rest' | 'cock' | 'reach' | 'hold' | 'back' | 'dead' | 'work';
  t: number; wait: number; dead: boolean; box: ReturnType<LevelBuild['ctx']['physics']['addBox']>; lamp: THREE.MeshStandardMaterial; hit: boolean;
}

function buildTunnel(L: LevelBuild, b: Builder, R: Rng) {
  const ctx = L.ctx;
  const { x0, x1, zN, zS, roof, inner } = TUN;
  const y = BELT.y;
  const zc = (zN + zS) / 2, len = zN - zS;
  // ── outer shell: plated box with ribs, access hatches, piping, warning lamps ──
  const W = 'wall_panel_dark';
  for (const [x, f] of [[x0, '-x'], [x1, '+x']] as const) {
    b.box(W, x + (f === '-x' ? 0.1 : -0.1), roof / 2, zc, 0.2, roof, len);
    b.collide(x + (f === '-x' ? 0 : -0.2), 0, zS, x + (f === '-x' ? 0.2 : 0), roof, zN);
    b.detail(() => {
      const sx = f === '-x' ? -1 : 1, xf = x + (f === '-x' ? 0 : 0);
      for (let z = zN - 0.75; z > zS; z -= 1.5) {
        b.box('painted_yellow', xf + sx * 0.04, roof / 2, z, 0.08, roof, 0.16); // ribs
        panelOn(b, 'trim_steel', xf, roof * 0.55, z - 0.75, 1.2, roof * 0.6, f, 0.025, 0.03);
      }
      b.box('hazard_stripes', xf + sx * 0.005, 0.25, zc, 0.01, 0.3, len);
      for (let i = 0; i < 3; i++) pipe(b, i === 1 ? 'copper' : 'steel_raw', [[xf + sx * 0.14, 2.6 + i * 0.22, zN + 0.2], [xf + sx * 0.14, 2.6 + i * 0.22, zS - 0.2]], 0.045 - i * 0.008, { every: 3 });
      valve(b, xf + sx * 0.14, 2.6, -56, 'z', 0.045, 'x', sx);
      b.sign('FITTING TUNNEL 2 — DANGER — MOVING MACHINERY', 'danger', xf + sx * 0.012, 1.5, -53.5, 2.4, 0.28, f, 0, true);
      b.sign('NO PERSONNEL ON BELT', 'warning', xf + sx * 0.012, 1.5, -59, 1.6, 0.22, f, 0, true);
    });
  }
  b.bx(W, x0, roof, zS, x1, roof + 0.25, zN);
  b.collide(x0, roof, zS, x1, roof + 0.25, zN, 'metal', false);
  b.detail(() => {
    for (let z = zN - 0.75; z > zS; z -= 1.5) b.box('painted_yellow', (x0 + x1) / 2, roof + 0.3, z, x1 - x0 + 0.1, 0.1, 0.16);
    // hydraulic power pack + cooling on the roof
    b.box('painted_dark', 4.2, roof + 0.7, -52.5, 1.6, 0.9, 1.6);
    b.box('painted_yellow', 6.2, roof + 0.55, -52.5, 1.0, 0.6, 1.2);
    for (let i = 0; i < 6; i++) b.box('trim_steel', 4.2, roof + 0.7, -53.2 + i * 0.28, 1.64, 0.7, 0.04);
    b.cyl('steel_raw', 5.2, roof + 0.6, -57.5, 0.45, 2.2, 'z', 18);
    b.cyl('trim_steel', 5.2, roof + 0.6, -56.4, 0.48, 0.06, 'z', 18).cyl('trim_steel', 5.2, roof + 0.6, -58.6, 0.48, 0.06, 'z', 18);
    hose(b, 'rubber', [[4.6, roof + 0.4, -53.2], [4.2, roof + 0.3, -55], [4.8, roof + 0.4, -57]], 0.05, 6);
    hose(b, 'rubber', [[6.4, roof + 0.4, -53.1], [6.8, roof + 0.3, -55.5], [6.0, roof + 0.4, -58.4]], 0.04, 6);
    cableBundle(b, [3.0, roof + 0.3, -60], [3.0, 7.9, -60.5], 4, 0.6, 0.02, 0.06, R);
  });
  // ── mouth (north) and exit (south): heavy frames, chevrons, lamps; strip curtains ──
  for (const [z, s, label] of [[zN, 1, 'FITTING 2 — IN'], [zS, -1, 'FITTING 2 — OUT']] as const) {
    b.at((x0 + x1) / 2, 0, z, s > 0 ? 0 : PI, () => {
      // face plate with the opening (belt width + 0.4, 2.7 high above the belt)
      const ow = 2.6, oh = 2.7;
      b.box('painted_yellow', -(ow / 2 + (x1 - x0 - ow) / 4), roof / 2, 0.08, (x1 - x0 - ow) / 2, roof, 0.16);
      b.box('painted_yellow', ow / 2 + (x1 - x0 - ow) / 4, roof / 2, 0.08, (x1 - x0 - ow) / 2, roof, 0.16);
      b.box('painted_yellow', 0, (y + oh + roof) / 2, 0.08, ow, roof - y - oh, 0.16);
      b.box('painted_dark', 0, y / 2, 0.08, ow, y, 0.16);
      b.detail(() => {
        for (const sx of [-1, 1]) b.box('hazard_stripes', sx * (ow / 2 + 0.1), y + oh / 2, 0.165, 0.2, oh, 0.004);
        b.box('hazard_stripes', 0, y + oh + 0.1, 0.165, ow + 0.4, 0.2, 0.004);
        b.sign(label, 'label', 0, roof - 0.2, 0.17, 1.4, 0.18, '+z');
        for (const sx of [-1, 1]) { b.box('painted_dark', sx * 1.85, 2.0, 0.2, 0.3, 0.5, 0.08); b.inst('led_red', sx * 1.85, 2.15, 0.245); b.inst('led_amber', sx * 1.85, 2.05, 0.245); }
        // curtain rail
        b.box('trim_steel', 0, y + oh - 0.02, 0.24, ow, 0.05, 0.05);
      });
    });
    const lamp = beacon(b, L, 'line_emergency', (x0 + x1) / 2 + 1.85, roof, z + s * 0.25, 1, 0xff8a10, 30, 7, 'emissive_amber', false, 'alarm');
    void lamp;
  }
  const curtains = stripCurtains(L, [zN + 0.24, zS - 0.24]);
  // ── interior: dark bays both sides, belt guards, machinery ──
  const gb = L.namedBuilder('tunnel_in');
  gb.rooms = ['line'];
  for (const s of [-1, 1] as const) {
    const gx = s < 0 ? BELT.x0 - 0.16 : BELT.x1 + 0.16;
    // guard walls up to 1.2 above the belt, then the open bay
    gb.bx('painted_dark', gx - 0.04, y, zS, gx + 0.04, y + 1.2, zN);
    gb.detail(() => { gb.bx('hazard_stripes', gx + s * -0.045, y + 1.05, zS, gx + s * -0.04, y + 1.2, zN); });
    gb.collide(gx - 0.05, y, zS, gx + 0.05, inner, zN); // invisible above the guard: the bays are not reachable
    // bay floors and back walls (dark machinery)
    const bx0 = s < 0 ? x0 + 0.2 : gx + 0.04, bx1 = s < 0 ? gx - 0.04 : x1 - 0.2;
    gb.bx('painted_dark', bx0, 0, zS, bx1, y + 0.4, zN);
    gb.detail(() => {
      for (let z = zN - 1; z > zS; z -= 2) {
        gb.box('robot_frame', (bx0 + bx1) / 2, y + 0.65, z, bx1 - bx0 - 0.1, 0.5, 0.5);
        gb.cyl('robot_joint', (bx0 + bx1) / 2, y + 0.95, z, 0.12, 0.2, 'y', 10);
        hose(gb, 'rubber', [[(bx0 + bx1) / 2, y + 1.0, z], [(bx0 + bx1) / 2 + s * 0.2, y + 1.8, z + 0.5], [s < 0 ? x0 + 0.25 : x1 - 0.25, 2.8, z + 0.9]], 0.03, 5);
      }
    });
  }
  gb.bx('painted_dark', x0 + 0.2, inner, zS, x1 - 0.2, inner + 0.05, zN);
  gb.collide(BELT.x0 - 0.2, inner, zS, BELT.x1 + 0.2, inner + 0.1, zN, 'metal', false);
  gb.detail(() => {
    // overhead: rails for the fitting heads, cable chains, sensor bars with red pin lights
    for (const x of [BELT.x0 + 0.3, BELT.x1 - 0.3]) ibeam(gb, 'robot_frame', 'z', x, inner - 0.12, zc, len, 0.12, 0.18);
    for (let z = zN - 1.6; z > zS; z -= 2.4) {
      gb.box('painted_dark', 5, inner - 0.3, z, 2.2, 0.08, 0.12);
      for (let k = -4; k <= 4; k++) gb.inst('led_red', 5 + k * 0.22, inner - 0.345, z, PI / 2, 0, 0);
    }
    for (let i = 0; i < 2; i++) cable(gb, 'rubber', [3.3 + i * 3.4, inner - 0.1, zN - 0.5], [3.3 + i * 3.4, inner - 0.1, zS + 0.5], 0.5, 0.03, 16, 5);
  });
  // ── presses: two overhead fitting presses cycling over the belt; a third that drops in behind you ──
  const presses: { g: THREE.Group; z: number; phase: number; up: number; low: number }[] = [];
  const mkPress = (z: number, name: string) => {
    const p = L.part(name);
    p.box('robot_frame', 0, 0.2, 0, 1.7, 0.4, 0.9);
    p.box('painted_yellow', 0, 0.48, 0, 1.4, 0.16, 0.7);
    p.box('robot_frame', 0, -0.02, 0, 1.5, 0.06, 0.8);
    for (const sx of [-0.55, 0.55]) p.cyl('robot_frame', sx, 0.9, 0, 0.05, 1.0, 'y', 10);
    p.cyl('robot_frame', 0, 0.9, 0, 0.14, 0.9, 'y', 12);
    p.cast = false;
    p.box('hazard_stripes', 0, 0.2, 0.452, 1.7, 0.36, 0.004).box('hazard_stripes', 0, 0.2, -0.452, 1.7, 0.36, 0.004);
    const g = p.build(false);
    g.position.set(5, 2.75, z);
    for (const m of g.children) { m.castShadow = true; }
    g.userData.rooms = ['line'];
    L.root.add(g);
    return g;
  };
  for (const z of [-53.0, -59.2]) presses.push({ g: mkPress(z, 'tunnel:press'), z, phase: z * 0.7, up: 2.75, low: 2.48 });
  // housings for the press guides in the roof
  gb.detail(() => { for (const z of [-53.0, -59.2]) { gb.box('robot_frame', 5, inner - 0.05, z, 1.9, 0.12, 1.1); } });
  const drop = mkPress(-55, 'tunnel:dropper');
  drop.visible = false;
  // ── fitting heads on the overhead rails: welders (spark when the line runs), a sensor head ──
  const sparks: { enabled: boolean }[] = [];
  for (const [x, z] of [[BELT.x0 + 0.3, -51.4], [BELT.x1 - 0.3, -55.6], [BELT.x0 + 0.3, -58.4], [BELT.x1 - 0.3, -61.0]] as const) {
    gb.detail(() => {
      gb.box('robot_frame', x, inner - 0.3, z, 0.24, 0.2, 0.3);
      gb.cyl('robot_joint', x, inner - 0.5, z, 0.06, 0.25, 'y', 10);
      gb.rbox('robot_joint', x + (x < 5 ? 0.12 : -0.12), inner - 0.75, z, 0.05, 0.35, 0.05, 0, 0, x < 5 ? 0.6 : -0.6);
      gb.sphere('emissive_cyan', x + (x < 5 ? 0.24 : -0.24), inner - 0.92, z, 0.014, 6);
      hose(gb, 'rubber', [[x, inner - 0.2, z], [x + 0.2, inner - 0.05, z + 0.4], [x + 0.25, inner - 0.12, z + 1.0]], 0.015, 4);
    });
    const e = ctx.fx.emitter('sparks', L.vec(x + (x < 5 ? 0.24 : -0.24), inner - 0.92, z), L.vec(0, -1, 0), 6);
    e.enabled = false;
    sparks.push(e);
  }
  const steam = [ctx.fx.emitter('steam', L.vec(3.2, 1.2, -54.5), L.vec(0.6, 0.6, 0), 18), ctx.fx.emitter('steam', L.vec(6.8, 1.0, -60.2), L.vec(-0.6, 0.5, 0), 18)];
  for (const e of steam) e.enabled = false;
  // ── arms: four, two per side, staggered ──
  const arms = buildArms(L, gb, [[-1, -52.0], [1, -54.6], [-1, -57.2], [1, -60.0]]);
  // ── light: dark, then strobing work lights once the line runs ──
  const strobes: ReturnType<LevelBuild['spot']>[] = [];
  for (const [z, s] of [[-51.5, -1], [-55.5, 1], [-59.5, -1]] as const) {
    const lx = s < 0 ? x0 + 0.45 : x1 - 0.45;
    const h = L.spot('tunnel', lx, inner - 0.2, z, 5, y, z - 0.6, 0xe8f2ff, 60, 6, 0.9, { flicker: 'strobe', enabled: false, priority: 3, cast: z === -55.5, penumbra: 0.4 });
    strobes.push(h);
    const gm = L.glow(h, 'emissive_white', 1.5);
    gb.detail(() => { gb.box('painted_dark', lx, inner - 0.12, z, 0.3, 0.16, 0.22); gb.box(gm, lx + (s < 0 ? 0.08 : -0.08), inner - 0.2, z, 0.12, 0.06, 0.18); });
  }
  L.point('tunnel', 5, 1.6, -57.5, 0xff2a12, 8, 4, { flicker: 'pulse', enabled: false });
  // a faint red standby glow so the inside is never pure black
  L.point('line', 5, 2.0, -56, 0x801008, 1.2, 6, { flicker: 'pulse', priority: 1 });
  // the machine seen from the walkway: a flood on the mouth, a wash along its west flank
  L.spot('line', 1.2, 6.2, -45.5, 5, 1.6, -50.2, 0xffb060, 160, 12, 0.5, { priority: 2, penumbra: 0.6, bounds: new THREE.Box3(new THREE.Vector3(-10, -1, -49.9), new THREE.Vector3(10, 10, -22)) });
  L.spot('line', -0.5, 5.5, -56, 2.6, 1.6, -56, 0xffa04a, 120, 11, 0.85, { priority: 1, penumbra: 0.8, bounds: new THREE.Box3(new THREE.Vector3(-10, -1, -70), new THREE.Vector3(2.55, 10, -22)) });
  const mouthO = new THREE.Object3D(); mouthO.name = 'tunnel_mouth'; mouthO.position.set(5, y, zN); L.root.add(mouthO); L.objects.set('tunnel_mouth', mouthO);
  const exitO = new THREE.Object3D(); exitO.name = 'tunnel_exit'; exitO.position.set(5, y, zS); L.root.add(exitO); L.objects.set('tunnel_exit', exitO);

  // ── l2_tunnel ──
  let state: MachineState = 'off';
  const api = { onHit: null as null | (() => void) };
  L.machines.set('l2_tunnel', (s) => {
    state = s;
    for (const e of sparks) e.enabled = s === 'active' || s === 'frenzy';
    for (const e of steam) e.enabled = s !== 'off';
  });
  const pl = () => ctx.player;
  const onBeltInTunnel = () => { const p = pl()?.position; return !!p && p.x > BELT.x0 - 0.1 && p.x < BELT.x1 + 0.1 && p.z < zN + 1 && p.z > zS - 0.5 && p.y > y - 0.2 && p.y < y + 0.4; };
  ctx.events.on('bullet:impact', (e) => {
    for (const a of arms) {
      if (a.dead) continue;
      const bx = a.box.box;
      if (e.point.x > bx.min.x - 0.12 && e.point.x < bx.max.x + 0.12 && e.point.y > bx.min.y - 0.12 && e.point.y < bx.max.y + 0.12 && e.point.z > bx.min.z - 0.12 && e.point.z < bx.max.z + 0.12) {
        a.dead = true; a.phase = 'dead'; a.t = 0; a.box.enabled = false;
        ctx.fx.sparks(e.point, e.normal, 26, 5);
        ctx.fx.fluid(e.point, e.normal, 14);
        ctx.fx.flash(e.point, 0x9fd8ff, 80, 0.12, 5);
        a.el.getWorldPosition(_v); a.wr.getWorldPosition(_w);
        ctx.fx.arc(_v, _w, 0.5);
        a.lamp.emissiveIntensity = 0;
        L.sfx('spark_zap', e.point.x, e.point.y, e.point.z, 1);
        L.sfx('metal_clang', e.point.x, e.point.y, e.point.z, 0.8, 0.8);
      }
    }
  });
  L.updaters.push((dt, t) => {
    const running = state === 'active' || state === 'frenzy' || state === 'idle';
    const vis = L.isVisible('line');
    // presses
    for (const p of presses) {
      if (!running) { p.g.position.y += (p.up - p.g.position.y) * Math.min(1, dt * 2); continue; }
      const rate = state === 'idle' ? 0.25 : 0.55;
      const c = ((t + p.phase) * rate) % 1;
      // hold up, slam down fast, dwell, lift slowly
      const yv = c < 0.55 ? p.up : c < 0.6 ? p.up - (p.up - p.low) * easeIn((c - 0.55) / 0.05) : c < 0.72 ? p.low : p.low + (p.up - p.low) * easeInOut((c - 0.72) / 0.28);
      if (c >= 0.6 && p.g.position.y > p.low + 0.02 && vis) L.sfx('press_slam', 5, p.low, p.z, state === 'idle' ? 0.4 : 0.8);
      p.g.position.y = yv;
    }
    // arms
    const player = pl();
    const target = (state === 'active' || state === 'frenzy') && onBeltInTunnel() && player?.alive !== false ? player : null;
    for (const a of arms) updateArm(L, a, dt, t, state, target, api);
    for (const c of curtains) c(dt);
  });
  // tunnel_press: a press slams down onto the belt just behind the player
  L.vignette('tunnel_press', () => {
    const p = pl()?.position;
    const z = THREE.MathUtils.clamp((p?.z ?? -55) + 1.5, zS + 1, zN - 1);
    drop.position.set(5, inner + 0.6, z);
    drop.visible = true;
    L.tween(0, 0.16, (k) => { drop.position.y = inner + 0.6 - (inner + 0.6 - (y + 0.05)) * easeIn(k); }, () => {
      L.sfx('press_slam', 5, y + 0.4, z, 1.2, 0.85);
      ctx.player?.shake(0.55);
      ctx.fx.sparks(_v.set(4.3, y + 0.05, z), _up, 18, 4); ctx.fx.sparks(_v.set(5.7, y + 0.05, z), _up, 18, 4);
      ctx.fx.smoke(_v.set(5, y + 0.3, z), { count: 6, size: 0.5, color: 0x6a6660, rise: 0.4, life: 2 });
    });
    L.tween(1.6, 2.2, (k) => { drop.position.y = y + 0.05 + (inner + 0.6 - y) * easeInOut(k); }, () => { drop.visible = false; });
  });
  // tunnel_silhouette: ahead on the belt, a figure on its back, lit by one strobe, carried into the dark
  const sil = silhouette(L);
  const silLight = L.spot('tunnel_sil', 5, inner - 0.25, -56, 5, y, -56, 0xeef4ff, 70, 4.5, 0.55, { flicker: 'strobe', enabled: false, priority: 4, penumbra: 0.3 });
  L.vignette('tunnel_silhouette', () => {
    const p = pl()?.position;
    let z = (p?.z ?? zN) - 5;
    z = Math.max(z, zS + 3);
    sil.position.set(5, y, z);
    sil.visible = true;
    silLight.enabled = true;
    L.sim((dt) => {
      z -= BELT.speed * dt;
      sil.position.z = z;
      silLight.position.z = z + 0.4; silLight.target.z = z;
      if (z < zS + 0.3) { sil.visible = false; silLight.enabled = false; return false; }
      return true;
    });
    L.after(2.2, () => { silLight.enabled = false; });
  });
  return api;
}

/** The strip curtains at mouth and exit: one instanced mesh; strips near the player bend away. */
function stripCurtains(L: LevelBuild, zs: number[]): ((dt: number) => void)[] {
  const n = 9, w = 2.5 / n, top = BELT.y + 2.66, len = 2.55;
  const geo = new THREE.BoxGeometry(w * 0.92, len, 0.006).translate(0, -len / 2, 0);
  const mat = L.ctx.materials.clone('rubber', { color: 0x9aa4a0, transparent: true, opacity: 0.82, roughness: 0.35 });
  const out: ((dt: number) => void)[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  for (const z of zs) {
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.name = 'tunnel:curtain';
    im.castShadow = false; im.receiveShadow = true;
    im.userData.rooms = ['line'];
    const ang = new Float32Array(n), vel = new Float32Array(n);
    const write = () => {
      for (let i = 0; i < n; i++) {
        q.setFromEuler(e.set(ang[i], 0, 0));
        m4.compose(pv.set(5 - 1.25 + (i + 0.5) * w, top, z), q, s1);
        im.setMatrixAt(i, m4);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    write();
    im.computeBoundingSphere(); im.boundingSphere!.radius += 2;
    L.root.add(im);
    out.push((dt) => {
      const p = L.ctx.player?.position;
      let moved = false;
      for (let i = 0; i < n; i++) {
        let goal = 0;
        if (p) {
          const dx = Math.abs(p.x - (5 - 1.25 + (i + 0.5) * w)), dz = p.z - z;
          if (dx < 0.55 && Math.abs(dz) < 0.6 && p.y > BELT.y - 0.2) goal = (dz > 0 ? -1 : 1) * 1.2 * (1 - dx / 0.55);
        }
        vel[i] += ((goal - ang[i]) * 30 - vel[i] * 4) * dt;
        ang[i] += vel[i] * dt;
        if (Math.abs(ang[i]) > 1e-3 || Math.abs(vel[i]) > 1e-3) moved = true;
      }
      if (moved) write();
    });
  }
  return out;
}

/** A body on its back on the belt (coverall, bare feet, head turned). Lives under the tunnel vignette. */
function silhouette(L: LevelBuild): THREE.Group {
  const p = L.part('tunnel:figure');
  p.sphere('cloth_coverall', 0, 0.12, 0.2, 0.2, 10, 0.55, 1.0, 1.9);   // torso along +z (head south)
  p.sphere('cloth_coverall', 0, 0.1, -0.45, 0.16, 10, 0.6, 1.0, 1.0);  // hips
  for (const s of [-1, 1]) {
    p.rod('cloth_coverall', s * 0.1, 0.09, -0.55, s * 0.13, 0.08, -1.3, 0.07, 8);
    p.sphere('skin', s * 0.13, 0.08, -1.36, 0.05, 8, 1, 1, 1.6);
    p.rod('cloth_coverall', s * 0.22, 0.1, 0.45, s * 0.3, 0.06, -0.1, 0.05, 8);
    p.sphere('skin', s * 0.31, 0.05, -0.16, 0.045, 8);
  }
  p.sphere('skin', 0.03, 0.12, 0.72, 0.11, 12, 1.0, 0.95, 1.15);
  p.sphere('plastic_dark', 0.03, 0.17, 0.74, 0.11, 10, 0.55, 1.0, 1.1); // hair
  const g = p.build(false);
  const grp = new THREE.Group();
  grp.add(g);
  g.rotation.y = PI; // head towards the direction of travel (south)
  for (const m of g.children) m.castShadow = true;
  grp.visible = false;
  grp.userData.rooms = ['line'];
  L.root.add(grp);
  return grp;
}

function buildArms(L: LevelBuild, gb: Builder, list: [1 | -1, number][]): TunnelArm[] {
  const root = new THREE.Group();
  root.name = 'tunnel_arms';
  root.userData.rooms = ['line'];
  L.root.add(root);
  const bones: THREE.Bone[] = [];
  const parts: { b: Builder; bone: number }[] = [];
  const arms: TunnelArm[] = [];
  const Y: Mat = 'painted_orange', J: Mat = 'robot_joint', F: Mat = 'robot_frame';
  for (const [side, z] of list) {
    const bx = side < 0 ? TUN.x0 + 0.3 : TUN.x1 - 0.3, by = 2.2;
    // wall mount (static)
    gb.at(bx, by, z, side < 0 ? PI / 2 : -PI / 2, () => {
      gb.box(F, 0, 0, -0.08, 0.5, 0.7, 0.16);
      bolts4(gb, -0.25, -0.35, 0.25, 0.35, 0);
      hose(gb, 'rubber', [[0.15, -0.3, 0], [0.3, -0.9, 0.05], [0.2, -1.5, 0]], 0.025, 5);
    });
    const base = new THREE.Bone(), sh = new THREE.Bone(), el = new THREE.Bone(), wr = new THREE.Bone();
    base.position.set(bx, by, z); base.rotation.y = side < 0 ? PI / 2 : -PI / 2;
    base.add(sh); sh.position.set(0, 0, 0.12);
    sh.add(el); el.position.set(0, 0.85, 0);
    el.add(wr); wr.position.set(0, 0.8, 0);
    root.add(base);
    const i0 = bones.length;
    bones.push(base, sh, el, wr);
    let p = L.part('arm2:base');
    p.cyl(F, 0, 0, 0.0, 0.16, 0.22, 'z', 14);
    p.cyl(J, 0, 0, 0.12, 0.1, 0.12, 'x', 10);
    parts.push({ b: p, bone: i0 });
    p = L.part('arm2:upper');
    p.box(Y, 0, 0.42, 0, 0.16, 0.8, 0.18);
    p.cyl(J, 0, 0, 0, 0.09, 0.24, 'x', 10);
    p.cyl(J, 0, 0.42, -0.12, 0.03, 0.6, 'y', 8);
    hose(p, 'rubber', [[0.09, 0.05, -0.05], [0.12, 0.45, -0.08], [0.09, 0.82, 0]], 0.014, 4);
    parts.push({ b: p, bone: i0 + 1 });
    p = L.part('arm2:fore');
    p.box(Y, 0, 0.4, 0, 0.13, 0.76, 0.14);
    p.cyl(J, 0, 0, 0, 0.08, 0.2, 'x', 10);
    p.box(F, 0, 0.1, -0.1, 0.1, 0.18, 0.08);
    parts.push({ b: p, bone: i0 + 2 });
    p = L.part('arm2:claw');
    p.cyl(J, 0, 0.03, 0, 0.07, 0.06, 'y', 10);
    p.box(F, 0, 0.12, 0, 0.18, 0.12, 0.1);
    for (const s of [-1, 1]) { p.rbox(J, s * 0.07, 0.27, 0, 0.03, 0.22, 0.05, 0, 0, s * 0.25); p.rbox(J, s * 0.05, 0.42, 0, 0.025, 0.12, 0.04, 0, 0, -s * 0.35); }
    p.box('emissive_red', 0, 0.12, 0.052, 0.04, 0.02, 0.004);
    parts.push({ b: p, bone: i0 + 3 });
    const lamp = L.ctx.materials.clone('emissive_red');
    gb.detail(() => gb.box(lamp, bx + (side < 0 ? 0.04 : -0.04), by + 0.42, z, 0.06, 0.06, 0.12));
    const box = L.ctx.physics.addBox(new THREE.Box3(), 'metal');
    arms.push({ base, sh, el, wr, side, z, bx, by, phase: 'rest', t: 0, wait: 1 + Math.abs(z) % 3, dead: false, box, lamp, hit: false });
  }
  skinParts(root, bones, parts, () => true, new THREE.Vector3(5, 2, -56), 8);
  for (const a of arms) poseArm(a, 0.15, 2.7, 0);
  return arms;
}

/** sh: shoulder pitch (0 = up the wall, π/2 = straight across), el: elbow bend, sw: sweep (yaw) along the tunnel. */
function poseArm(a: TunnelArm, sh: number, el: number, sw: number) {
  a.sh.rotation.x = sh; a.el.rotation.x = el; a.base.rotation.y = (a.side < 0 ? PI / 2 : -PI / 2) + sw * a.side;
  a.wr.rotation.y = sh * 2;
}

const REST: [number, number] = [0.15, 2.7];
const COCK: [number, number] = [0.9, 1.7];
const REACH: [number, number] = [PI / 2, 0.05];
const WORK: [number, number] = [1.15, 0.9];

function updateArm(L: LevelBuild, a: TunnelArm, dt: number, t: number, state: MachineState, target: { position: THREE.Vector3; eye: THREE.Vector3; damage(n: number, from?: THREE.Vector3): void; shake(n: number): void } | null, api: { onHit: null | (() => void) }) {
  const lerp = (p: [number, number], q: [number, number], k: number, sw = 0) => poseArm(a, p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, sw);
  a.t += dt;
  const sweepTo = target ? THREE.MathUtils.clamp((target.position.z - a.z) * -0.35, -0.5, 0.5) : 0;
  if (a.dead) {
    // shot through the joint: it sags, twitches, drips sparks now and then
    const k = Math.min(1, a.t / 0.6);
    poseArm(a, REST[0] + 0.8 * easeOut(k), 0.4 + Math.sin(t * 23) * 0.03 * Math.max(0, 1 - a.t / 4), 0.2);
    if (Math.random() < dt * 0.6) { a.el.getWorldPosition(_v); L.ctx.fx.sparks(_v, _up, 4, 2); }
    return;
  }
  if (state === 'off') { if (a.phase !== 'rest') { a.phase = 'rest'; } lerp(REST, REST, 0); a.box.enabled = false; return; }
  const strike = !!target && Math.abs(target.position.z - a.z) < 1.6;
  switch (a.phase) {
    case 'rest':
    case 'work': {
      // idle work: fit something to the belt, slowly
      const c = (t * 0.35 + a.z) % 1;
      const k = c < 0.5 ? easeInOut(c * 2) : easeInOut(2 - c * 2);
      lerp(REST, WORK, k * (state === 'idle' ? 0.8 : 1));
      a.lamp.emissiveIntensity = 0.6;
      a.wait -= dt;
      if (strike && a.wait <= 0) { a.phase = 'cock'; a.t = 0; L.sfx('arm_reach', a.bx, a.by, a.z, 0.6, 0.8); }
      break;
    }
    case 'cock': {
      const k = Math.min(1, a.t / 0.55);
      lerp(REST, COCK, easeInOut(k), sweepTo * k);
      a.lamp.emissiveIntensity = Math.sin(a.t * 40) > 0 ? 6 : 0.5; // telegraph
      if (a.t >= 0.6) { a.phase = 'reach'; a.t = 0; a.hit = false; L.sfx('arm_reach', a.bx, a.by, a.z, 1, 1.2); }
      break;
    }
    case 'reach': {
      const k = Math.min(1, a.t / 0.22);
      lerp(COCK, REACH, easeOut(k), sweepTo);
      if (k > 0.6 && !a.hit && target) {
        // claw tip vs head / chest: a crouched player is well under the sweep
        a.wr.getWorldPosition(_v);
        _w.copy(target.eye);
        const dHead = _v.distanceTo(_w);
        _w.y -= 0.42;
        const dChest = _v.distanceTo(_w);
        if (dHead < 0.55 || dChest < 0.45) {
          a.hit = true;
          target.damage(6, _v);
          target.shake(0.5);
          api.onHit?.();
          L.sfx('metal_clang', _v.x, _v.y, _v.z, 0.9, 1.3);
        }
      }
      if (a.t >= 0.22) { a.phase = 'hold'; a.t = 0; }
      break;
    }
    case 'hold':
      lerp(REACH, REACH, 0, sweepTo);
      a.wr.rotation.z = Math.sin(t * 30) * 0.1;
      if (a.t > (a.hit ? 0.7 : 0.35)) { a.phase = 'back'; a.t = 0; }
      break;
    case 'back': {
      const k = Math.min(1, a.t / 0.9);
      lerp(REACH, REST, easeInOut(k), sweepTo * (1 - k));
      if (k >= 1) { a.phase = 'rest'; a.wait = 1.6 + Math.random() * 1.4; }
      break;
    }
  }
  // the shootable joint follows the elbow
  a.el.getWorldPosition(_v);
  a.box.box.min.set(_v.x - 0.16, _v.y - 0.16, _v.z - 0.16);
  a.box.box.max.set(_v.x + 0.16, _v.y + 0.16, _v.z + 0.16);
  a.box.enabled = state === 'active' || state === 'frenzy';
}

// ───────────────────────────────────────────────────────────── apron, gate

function apron(L: LevelBuild, b: Builder) {
  const y = BELT.y, x0 = 3.2, x1 = 6.8, zN = BELT.zS, zS = -66.2;
  b.bx('painted_dark', x0, 0, zS, x1, y - 0.03, zN);
  b.bx('floor_plate', x0, y - 0.03, zS, x1, y, zN);
  b.collide(x0, 0, zS, x1, y, zN);
  const steps = 4, rise = y / steps;
  for (let i = 0; i < steps; i++) {
    const sx0 = x0 - (steps - i) * 0.28;
    b.bx('floor_plate', sx0, 0, -65.9, sx0 + 0.28, (i + 1) * rise, -64.0);
    b.collide(sx0, 0, -65.9, sx0 + 0.28, (i + 1) * rise, -64.0, 'metal', false);
    b.detail(() => b.bx('hazard_stripes', sx0, (i + 1) * rise - 0.004, -65.9, sx0 + 0.05, (i + 1) * rise + 0.002, -64.0));
  }
  handrail(b, 'painted_yellow', [[x1 - 0.05, y, zN], [x1 - 0.05, y, zS + 0.05], [x0 + 0.05, y, zS + 0.05]], 1.0, 1.3, true);
  handrail(b, 'painted_yellow', [[x0 + 0.05, y, zN], [x0 + 0.05, y, -64.0]], 1.0, 1.3, true);
  b.collide(x1 - 0.1, y, zS, x1, y + 1.05, zN); b.collide(x0, y, zS, x1, y + 1.05, zS + 0.1); b.collide(x0, y, -64.0, x0 + 0.1, y + 1.05, zN);
  b.sign('EXIT APRON — UNITS PROCEED TO STAGING', 'stencil', 5, y + 0.004, -65.0, 2.6, 0.3, '+y', PI);
  b.detail(() => { hazardStrip(b, x0, zN - 0.15, x1, zN, y); });
  workLight(b, L, 'line', 1.5, -67.6, Math.atan2(-(5 - 1.5), -(-64 + 67.6)), { intensity: 110, distance: 9, angle: 0.7, cast: true, pitch: 0.35 });
}

function walkwayGate(L: LevelBuild, b: Builder): { set(closed: boolean): void } {
  const z = GATE_Z, H = 2.3;
  const cg = L.doubleSided('floor_grate');
  // fixed fence: west wall → gate, gate → belt guard; and east of the tunnel
  const fence = (xa: number, xb: number) => {
    b.push(0, 0, z, 0);
    for (let x = xa; x < xb - 0.01; x += 2.0) cagePanel(b, cg, x, 0.05, Math.min(xb, x + 2.0), H, 0, 0.04, 'painted_yellow');
    b.pop();
    b.collide(xa, 0, z - 0.06, xb, H, z + 0.06);
  };
  fence(-9.8, -4.0);
  fence(-0.8, TUN.x0);
  fence(TUN.x1, 9.8);
  b.detail(() => {
    for (const x of [-4.0, -0.8]) { b.box('painted_yellow', x, (H + 0.3) / 2, z, 0.12, H + 0.3, 0.12); b.box('painted_dark', x, 0.04, z, 0.3, 0.08, 0.3); }
    b.box('trim_steel', -2.4, H + 0.22, z, 3.4, 0.1, 0.14); // track
    b.sign('SECTION C — LINE RUNNING: NO ACCESS SOUTH OF THIS GATE', 'danger', -6.5, 1.5, z + 0.05, 2.4, 0.3, '+z', 0, true);
  });
  // the sliding gate
  const gp = L.part('line:gate');
  cagePanel(gp, cg, -1.55, 0.05, 1.55, H, 0, 0.05, 'painted_yellow');
  gp.box('hazard_stripes', 0, 1.1, 0.03, 3.1, 0.12, 0.02);
  for (const s of [-1, 1]) gp.cyl('rubber', s * 1.2, H + 0.18, 0, 0.05, 0.06, 'z', 10);
  const g = gp.build(false);
  g.userData.rooms = ['line'];
  for (const m of g.children) m.castShadow = true;
  const openX = -5.6, shutX = -2.4;
  g.position.set(openX, 0, z + 0.12);
  L.root.add(g);
  const box = L.ctx.physics.addBox(new THREE.Box3(new THREE.Vector3(-4.0, 0, z - 0.1), new THREE.Vector3(-0.8, H, z + 0.2)), 'metal');
  box.enabled = false;
  let goal = openX;
  L.updaters.push((dt) => {
    const x = g.position.x;
    if (Math.abs(goal - x) < 1e-3) return;
    g.position.x = x + Math.sign(goal - x) * Math.min(Math.abs(goal - x), dt * 1.4);
    box.enabled = g.position.x > -3.0;
  });
  return {
    set(closed) {
      const ng = closed ? shutX : openX;
      if (ng === goal) return;
      goal = ng;
      L.sfx('gate_rattle', -2.4, 1.5, z, 0.6, 0.8);
    },
  };
}

// ───────────────────────────────────────────────────────────── hook conveyor

function hooks(L: LevelBuild, b: Builder): Conveyor {
  const railY = 6.8;
  const path = new LoopPath(1.4, -26.5, -61.0, 5);
  const loads: HookLoad[] = ['unit', 'empty', 'torso_head', 'unit_open', 'legs', 'unit', 'empty', 'torso_arm', 'unit', 'arms', 'unit_open', 'empty', 'unit', 'torso_head', 'legs', 'unit', 'empty', 'unit_open', 'torso', 'unit', 'empty', 'unit', 'arms', 'unit_open'];
  const conv = new Conveyor(L, b, path, railY, loads, 0.6);
  conv.travel = 0.35;
  // hangers from the roof trusses + a drive head at the north curve
  const pp = { x: 0, z: 0, tx: 0, tz: 0 };
  for (let s = 1.5; s < path.length; s += 4.2) {
    path.at(s, pp);
    b.detail(() => { b.rod('trim_steel', pp.x, railY + 0.1, pp.z, pp.x, 8.4, pp.z, 0.025, 6); b.box('trim_steel', pp.x, railY + 0.13, pp.z, 0.2, 0.06, 0.2); });
  }
  b.box('painted_dark', 5, railY + 0.5, -26.5, 1.0, 0.6, 1.0);
  b.detail(() => { b.box('painted_yellow', 5.8, railY + 0.5, -26.5, 0.5, 0.4, 0.5); b.rod('trim_steel', 5, railY + 0.8, -26.5, 5, 8.4, -26.5, 0.05, 8); });
  const sp = L.part('line:sprocket');
  sp.cyl('robot_joint', 0, 0, 0, 0.65, 0.06, 'y', 24);
  for (let i = 0; i < 12; i++) { const a = (i * PI) / 6; sp.box('robot_joint', Math.cos(a) * 0.68, 0, Math.sin(a) * 0.68, 0.08, 0.06, 0.08); }
  const sg = sp.build(false);
  sg.position.set(5, railY + 0.14, -26.5);
  sg.userData.rooms = ['line'];
  L.root.add(sg);
  conv.addSprocket(sg);
  // the parking spur at the south end: two hooks, two units waiting (g2_foreman's husks)
  const sy = 6.3, sz = -66.6;
  ibeam(b, 'painted_yellow', 'x', -0.9, sy, sz, 7.4, 0.14, 0.2, 0.02, 0.014);
  b.detail(() => {
    b.box('robot_joint', -0.9, sy - 0.13, sz, 7.4, 0.05, 0.03);
    for (const x of [-4.2, -0.9, 2.4]) b.rod('trim_steel', x, sy + 0.1, sz, x, 8.4, sz, 0.03, 6);
    b.box('hazard_stripes', 2.7, sy, sz, 0.2, 0.3, 0.16);
  });
  for (const x of [-2.6, 0.4]) {
    b.at(x, sy - 0.16, sz, 0, () => {
      b.box('robot_frame', 0, -0.02, 0, 0.2, 0.1, 0.3);
      b.cyl('robot_frame', 0, -0.32, 0, 0.022, 0.5, 'y', 6);
      b.box('robot_frame', 0, -0.58, 0, 0.5, 0.04, 0.05);
      for (const s of [-1, 1]) { b.box('robot_frame', s * 0.24, -0.66, 0, 0.03, 0.16, 0.05); b.box('robot_frame', s * 0.2, -0.74, 0.03, 0.1, 0.03, 0.1); }
    });
    L.enemy('g2_foreman', 'husk', 'dormant', x, sy - 0.16 - 2.19, sz, PI, 'rack', 'still');
  }
  return conv;
}
