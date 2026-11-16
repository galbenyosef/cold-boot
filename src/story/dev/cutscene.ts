/**
 * DEV ONLY — cutscene test scene (stage 3a §8.2 / §8.3, task P4). Loaded by `?cutdev=1` (story/camera.ts, lazy
 * chunk; never part of the level list) on the two-deck greybox:
 *
 *   /?level=3&greybox=deck2&nostory=1&autostart=1&give=all&cutdev=1
 *
 * Two scenes modelled on the plan's C1 / C2, in TEST UPPER (gb_up, Deck 2, floor 4.8; its door `dg_up` at
 * (0, 4.8, −10) to the gallery):
 *   dev_meet   — standing meet (≈ 10.6 s + 1.6 s black): he talks, his eyes drop to the lowered weapon, he beckons
 *                and walks off, the eye dollies after him (body follows), fade to black; under the black the body
 *                goes to the visitor chair, the door is shut + locked, he is in his chair. Then (chained, like
 *                C1 → C2) dev_seated, or control at the chair (`meet({ chain: false })`).
 *   dev_seated — seated (≈ 11.4 s): fade in on his face, look to the monitor + lean in + zoom, back to his face,
 *                down to the badge, then the release: rise from the chair turning ≈ 80° right toward the door over
 *                1.4 s, ending exactly on the player's view (hand-back). End state: placed, safe (weapon stowed),
 *                clip topped up, key `dev_badge`.
 *   safe zone  — after dev_seated the weapon stays stowed until the latch by the door is used (`dev_latch`, like the
 *                office latch D23): the door unlocks, `setSafe(false)`.
 * The human actor is pinned to `cutscene.eye` during both scenes (released to `auto` after).
 * `window.__cutdev` drives it for scripts/check-cutscene.mjs.
 */
import * as THREE from 'three';
import type { EnemyActor, GameContext } from '../../core/types';
import { Cutscene, lastShotYaw, shotPoseAt, shotsDuration, yawPitchTo, angleDelta, type CamShot, type CutResult, type PlayOpts } from '../cutscene';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const D2 = 4.8;

// layout (gb_up: x −6…6, z −10…0)
const MEET_BODY = V(0, D2, -6.8);
const MEET_ACTOR = V(0, D2, -3.2);
const WALK_TO = V(-3.6, D2, -1.2);
const SEAT = V(0.3, D2, -8.6);             // visitor chair (no collider), facing −x
const SEAT_EYE = V(0.3, 6.0, -8.6);
const H2 = V(-2.95, D2, -8.6);             // his chair, facing +x
const MONITOR = V(-1.6, 5.88, -8.15);
const BADGE = V(-1.4, 5.575, -8.45);
const DOOR = V(0, 6.0, -10);
const PLACE = V(0.4, D2, -8.3);
const PLACE_EYE = V(PLACE.x, D2 + 1.65, PLACE.z);
const PLACE_YAW = yawPitchTo(PLACE_EYE, DOOR).yaw;
const PLACE_PITCH = -0.05;
const LATCH = V(0.95, 6.0, -9.82);

type ActorRec = { a: EnemyActor; attn: 'auto' | 'pinned'; pose: string; at: string };

export function installCutsceneDev(ctx: GameContext, cut: Cutscene): void {
  const maybeDoor = ctx.level.doors.find((d) => d.id === 'dg_up') ?? null;
  if (!maybeDoor) { console.error('[cutdev] needs the two-deck greybox (&greybox=deck2)'); return; }
  const door = maybeDoor;
  const M = ctx.materials;

  // ── props (visual only; the visitor chair has no collider, like D23's)
  const props = new THREE.Group();
  props.name = 'cutdev_props';
  const box = (mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    props.add(m);
    return m;
  };
  const wood = M.get('wood_veneer'), dark = M.get('painted_dark'), cloth = M.get('fabric_warm'), steel = M.get('trim_steel');
  box(wood, -2.3, D2 + 0.72, -9.4, -1.3, D2 + 0.76, -7.8);                     // desk top 5.56
  box(dark, -2.25, D2, -9.35, -2.2, D2 + 0.72, -7.85); box(dark, -1.4, D2, -9.35, -1.35, D2 + 0.72, -7.85);
  box(cloth, H2.x - 0.25, D2 + 0.4, H2.z - 0.25, H2.x + 0.25, D2 + 0.46, H2.z + 0.25); // his seat
  box(cloth, H2.x - 0.3, D2 + 0.46, H2.z - 0.25, H2.x - 0.25, D2 + 1.1, H2.z + 0.25);
  box(steel, H2.x - 0.03, D2, H2.z - 0.03, H2.x + 0.03, D2 + 0.4, H2.z + 0.03);
  box(cloth, SEAT.x - 0.24, D2 + 0.4, SEAT.z - 0.24, SEAT.x + 0.24, D2 + 0.46, SEAT.z + 0.24); // visitor seat
  box(cloth, SEAT.x + 0.24, D2 + 0.46, SEAT.z - 0.24, SEAT.x + 0.29, D2 + 1.0, SEAT.z + 0.24);
  for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(steel, SEAT.x + dx - 0.015, D2, SEAT.z + dz - 0.015, SEAT.x + dx + 0.015, D2 + 0.4, SEAT.z + dz + 0.015);
  const screenMat = M.screen('terminal_idle', { aspect: 1.5, text: 'DEV MONITOR' });
  const monitor = box(screenMat, MONITOR.x - 0.02, MONITOR.y - 0.17, MONITOR.z - 0.25, MONITOR.x + 0.02, MONITOR.y + 0.17, MONITOR.z + 0.25);
  monitor.rotation.y = 0;
  box(dark, MONITOR.x - 0.06, D2 + 0.76, MONITOR.z - 0.05, MONITOR.x + 0.0, MONITOR.y - 0.17, MONITOR.z + 0.05);
  const badge = box(M.get('plastic_white'), BADGE.x - 0.045, BADGE.y - 0.004, BADGE.z - 0.03, BADGE.x + 0.045, BADGE.y + 0.004, BADGE.z + 0.03);
  badge.visible = false;
  const latchPlate = box(M.get('emissive_red'), LATCH.x - 0.08, LATCH.y - 0.08, LATCH.z - 0.02, LATCH.x + 0.08, LATCH.y + 0.08, LATCH.z + 0.0);
  ctx.scene.add(props);
  // a lamp over the desk (lights only through ctx.render.lights)
  try {
    ctx.render.lights.add({ type: 'spot', group: 'cutdev', position: V(-1.9, 7.7, -8.4), target: V(-2.6, 5.6, -8.6), color: 0xffe2b8, intensity: 40, distance: 7, angle: 0.9, penumbra: 0.6, castShadow: true, priority: 2 });
  } catch (e) { console.warn('[cutdev] desk lamp', e); }

  // ── the actor (absent until its beat: created when a scene starts)
  let actor: ActorRec | null = null;
  const track = (a: EnemyActor, pose: string, at: string): ActorRec => {
    const rec: ActorRec = { a, attn: 'auto', pose, at };
    const look = a.lookAt.bind(a);
    a.lookAt = (p) => { rec.attn = p ? 'pinned' : 'auto'; look(p); };
    const setPose = a.setPose.bind(a);
    a.setPose = (p) => { rec.pose = p; setPose(p); };
    return rec;
  };
  const spawn = (at: 'meet' | 'h2') => {
    actor?.a.remove();
    actor = at === 'meet'
      ? track(ctx.enemies.actor('human', MEET_ACTOR.clone(), 0, 'idle'), 'idle', 'meet')
      : track(ctx.enemies.actor('human', H2.clone(), -PI / 2, 'sit'), 'sit', 'h2');
    return actor;
  };
  const _hp = new THREE.Vector3();
  const head = (up = 0.08) => () => {
    const o = actor?.a.object.getObjectByName('head');
    if (o) { o.getWorldPosition(_hp); _hp.y += up; return _hp; }
    return _hp.copy(actor?.a.position ?? MEET_ACTOR).add(V(0, actor?.pose === 'sit' ? 1.25 : 1.62, 0));
  };
  const say = (speaker: string, text: string, duration: number) => {
    ctx.events.emit('story:subtitle', { speaker, text, duration });
    try { actor?.a.speak?.(duration); } catch { /* ignore */ }
  };

  // ── safe zone (D23 stand-in): the latch by the door ends it
  ctx.interactables.add({
    id: 'dev_latch', kind: 'button', position: LATCH.clone(), radius: 1.8, prompt: 'Release door latch', enabled: false,
    onUse: () => {
      door.unlock();
      ctx.player.setSafe?.(false);
      const it = ctx.interactables.get('dev_latch'); if (it) it.enabled = false;
      latchMat.emissiveIntensity = 0.2;
      ctx.events.emit('story:toast', { text: 'Latch released' });
    },
  });
  const latchMat = (latchPlate.material = (latchPlate.material as THREE.MeshStandardMaterial).clone()) as THREE.MeshStandardMaterial;
  const armLatch = () => { const it = ctx.interactables.get('dev_latch'); if (it) it.enabled = true; latchMat.emissiveIntensity = 2.5; };

  // ── end states (applied by natural end and skip alike; also the "checkpoint load" of the dev scene)
  const meetEnd = () => {
    ctx.player.teleport(SEAT, PI / 2, 0);
    door.lock();
    if (!actor || actor.at !== 'h2') spawn('h2');
    badge.visible = false;
  };
  const seatedEnd = () => {
    badge.visible = false;
    ctx.player.addKey('dev_badge');
    door.lock();
    if (!actor || actor.at !== 'h2') spawn('h2');
    actor!.a.setPose('sit');
    M.setScreen(screenMat, 'static');
    armLatch();
  };

  // ── scenes
  function meetShots(chain: boolean): { shots: CamShot[]; o: PlayOpts } {
    const a = spawn('meet');
    const eyeA = V(0, D2 + 1.65, MEET_BODY.z), eyeB = V(0, D2 + 1.65, -6.65), eyeC = V(-1.0, D2 + 1.65, -5.6);
    // where the lowered weapon is: a little ahead of and well below the eye (his eyes drop to it for a second)
    const lowGun = () => { const c = ctx.camera; return new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion).setY(0).normalize().multiplyScalar(0.4).add(c.position).add(V(0.05, -0.6, 0)); };
    const shots: CamShot[] = [
      { dur: 3.2, eye: [eyeA, eyeB], look: head(), fov: 72, body: MEET_BODY, bodyYaw: PI, enter: 'blend', blend: 0.35,
        cues: [{ t: 0.3, run: () => { a.a.setPose('talk'); say('MAN', "You're not on my list. Nobody's on my list.", 2.6); } }] },
      { dur: 2.4, eye: eyeB, look: head(), fov: 72,
        cues: [
          { t: 0.1, run: () => { a.a.lookAt(lowGun()); say('MAN', '…Is that thing loaded?', 1.8); } },
          { t: 1.1, run: () => a.a.lookAt(cut.eye) },
        ] },
      { dur: 3.0, eye: [eyeB, eyeC], look: head(0.18), body: 'follow', enter: 'blend', blend: 0.5,
        cues: [{ t: 0.0, run: () => { a.a.setPose('wave'); say('MAN', 'Come on. In here.', 1.4); } },
          { t: 0.8, run: () => { a.a.setPose('idle'); void a.a.moveTo(WALK_TO, 1.1); } }] },
      { dur: 1.2, eye: eyeC, look: head(0.18), fadeOut: 1.2, body: 'follow' },
      { dur: 1.6, eye: eyeC, black: true,
        cues: [{ t: 0.05, run: meetEnd, skip: () => { /* end() does it */ } }] },
    ];
    return {
      shots,
      o: {
        place: chain ? { pos: SEAT, yaw: PI / 2, pitch: 0 } : { pos: PLACE, yaw: PLACE_YAW, pitch: PLACE_PITCH },
        viewmodel: 'lowered', then: chain ? 'hold' : 'control', pin: [a.a],
        end: () => meetEnd(),
      },
    };
  }

  function seatedShots(): { shots: CamShot[]; o: PlayOpts } {
    if (!actor || actor.at !== 'h2') spawn('h2');
    const a = actor!;
    const e0 = SEAT_EYE, e1 = V(0.2, 6.0, -8.6), e2 = V(-0.05, 6.0, -8.5);
    const bp = yawPitchTo(e1, BADGE);
    const shots: CamShot[] = [
      { dur: 3.4, eye: [e0, e1], look: head(), fov: 60, enter: 'fade', fade: 0.6, body: SEAT, bodyYaw: PI / 2,
        cues: [{ t: 0.3, run: () => say('MAN', "They don't come up here. They never come up here.", 2.8) }] },
      { dur: 2.6, eye: [e1, e2], look: MONITOR, fov: [60, 52], enter: 'blend', blend: 0.8,
        cues: [{ t: 0.6, run: () => M.setScreen(screenMat, 'camera_feed'), skip: () => {} }] },
      { dur: 2.6, eye: [e2, e1], look: head(), fov: [52, 58], enter: 'blend', blend: 0.8,
        cues: [{ t: 0.2, run: () => { say('MAN', 'Take it. Facilities. It opens the service side.', 2.4); } }] },
      { dur: 1.4, eye: e1, look: BADGE, fov: 58, enter: 'blend', blend: 0.6,
        cues: [{ t: 0.05, run: () => { badge.visible = true; a.a.setPose('sit'); } }] },
      { dur: 1.4, eye: [e1, PLACE_EYE], yaw: [bp.yaw, PLACE_YAW], pitch: [bp.pitch, PLACE_PITCH], fov: [58, 72], handback: true,
        cues: [{ t: 1.2, run: () => { badge.visible = false; ctx.player.addKey('dev_badge'); ctx.events.emit('story:toast', { text: 'Facilities badge' }); } }] },
    ];
    return {
      shots,
      o: { place: { pos: PLACE, yaw: PLACE_YAW, pitch: PLACE_PITCH }, viewmodel: 'hidden', safe: true, topUp: true, pin: [a.a], end: () => seatedEnd() },
    };
  }

  const scenes: Record<string, { shots: CamShot[]; o: PlayOpts }> = {};
  async function meet(opts: { chain?: boolean } = {}): Promise<CutResult[]> {
    const chain = opts.chain ?? true;
    const m = meetShots(chain);
    scenes.dev_meet = m;
    const r1 = await cut.play('dev_meet', m.shots, m.o);
    if (!chain || r1 === 'refused') return [r1];
    const s = seatedShots();
    scenes.dev_seated = s;
    const r2 = await cut.play('dev_seated', s.shots, s.o);
    return [r1, r2];
  }
  async function seated(): Promise<CutResult> {
    ctx.player.teleport(SEAT, PI / 2, 0);
    door.lock();
    spawn('h2');
    const s = seatedShots();
    scenes.dev_seated = s;
    return cut.play('dev_seated', s.shots, s.o);
  }
  /** The dev scene's "checkpoint load" after dev_seated: the same end state without the scene. */
  function safeZone(): void {
    spawn('h2');
    seatedEnd();
    ctx.player.teleport(PLACE, PLACE_YAW, PLACE_PITCH);
    ctx.player.setSafe?.(true);
  }

  let armed: 'meet' | 'meet1' | 'seated' | null = null;
  let lastRun: Promise<unknown> | null = null;
  const results: unknown[] = [];
  ctx.events.on('trigger:enter', (e) => {
    if (e.id !== 'tg_up' || !armed) return;
    const which = armed; armed = null;
    lastRun = (which === 'seated' ? seated() : meet({ chain: which === 'meet' })).then((r) => { results.push(r); return r; });
  });

  function worldState() {
    const p = ctx.player, c = ctx.camera;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const st = (p as unknown as { debug: { state(): Record<string, unknown> } }).debug.state();
    return {
      pos: [r(p.position.x), r(p.position.y), r(p.position.z)], yaw: r(p.yaw), pitch: r(p.pitch), fov: r(c.fov),
      state: ctx.state, controls: p.controlsEnabled, safe: !!p.safe, stowed: st.stowed, lower: st.lower, vmVisible: st.vmVisible,
      cinematic: st.cinematic, weapon: p.currentWeapon,
      clips: Object.fromEntries(Object.entries(p.weapons).map(([k, w]) => [k, [w.clip, w.reserve]])),
      keys: [...p.keys].sort(), door: { locked: door.locked, closed: door.closed },
      actor: actor ? { at: actor.at, pose: actor.pose, attn: actor.attn, pos: actor.a.position.toArray().map(r) } : null,
      badge: badge.visible, screen: (screenMat.userData as { kind?: string }).kind ?? null,
      latch: !!ctx.interactables.get('dev_latch')?.enabled, eyeObj: cut.eye.position.toArray().map(r), cam: c.position.toArray().map(r),
    };
  }

  const api = {
    cut,
    meet, seated, safeZone, worldState,
    arm(which: 'meet' | 'meet1' | 'seated') { armed = which; },
    get results() { return results; },
    get running() { return lastRun; },
    shots(name: 'dev_meet' | 'dev_seated') {
      const s = scenes[name];
      if (!s) return null;
      return { total: shotsDuration(s.shots), lastYaw: lastShotYaw(s.shots), placeYaw: s.o.place.yaw, dYawDeg: THREE.MathUtils.radToDeg(angleDelta(lastShotYaw(s.shots), s.o.place.yaw)) };
    },
    /** The camera now next to the declared shot pose at the same scene time (no sway / blends). */
    poseNow() {
      const id = cut.id, s = id ? scenes[id] : null;
      if (!s || !cut.active) return null;
      const t = cut.time, c = ctx.camera;
      const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
      return { id, t, cam: { eye: c.position.toArray(), yaw: e.y, pitch: e.x, fov: c.fov }, want: shotPoseAt(s.shots, t) };
    },
    layout: { MEET_BODY, SEAT, SEAT_EYE, PLACE, PLACE_EYE, PLACE_YAW, PLACE_PITCH, LATCH, H2 },
    clearSeen() { try { localStorage.removeItem('coldboot.seen.v1'); } catch { /* ignore */ } },
    reset() {
      actor?.a.remove(); actor = null;
      door.unlock(); badge.visible = false;
      const it = ctx.interactables.get('dev_latch'); if (it) it.enabled = false;
      latchMat.emissiveIntensity = 0.2;
      ctx.player.setSafe?.(false);
      ctx.player.keys.forEach((k) => { if (k === 'dev_badge') (ctx.player.keys as Set<string>).delete(k); });
      M.setScreen(screenMat, 'terminal_idle', { text: 'DEV MONITOR' });
    },
  };
  (window as unknown as { __cutdev: typeof api }).__cutdev = api;
  console.log('[cutdev] installed: __cutdev.meet() / .seated() / .safeZone() / .arm("meet")');
}
