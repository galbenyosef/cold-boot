// Capture hooks, injected with page.addInitScript BEFORE any game code runs (scripts/demo/capture.mjs).
// Nothing in src/ is changed: this file virtualises time for the page and taps the game's audio.
//
//  • Virtual clock: performance.now / Date.now / setTimeout / setInterval / requestAnimationFrame all
//    run off one clock. Until __cap.begin() it follows real time (boot, loading). After begin() time only
//    moves when __cap.step() is called: exactly 1/60 s per captured frame, so every frame is perfectly paced.
//  • CSS animations / transitions (HUD, notes, cards) are paused and driven from the same clock.
//  • Audio: window.AudioContext is replaced with an OfflineAudioContext that renders in lock-step with
//    the frames (suspend at every frame boundary), so the procedural Web Audio mix is captured sample-
//    accurately and in sync. __cap.finishAudio() returns the rendered mix as a 16-bit WAV (base64).
//  • Input: once the game is ready, __cap.attach() routes ctx.input to a scripted input state, and
//    __cap.ctl offers a "human" camera (spring-damped yaw/pitch with overshoot + hand noise) and
//    waypoint walking. Shot scripts (scripts/demo/shots.mjs) drive it as coroutines.
(() => {
  const cfg = window.__capCfg || {};
  const RP = performance.now.bind(performance);
  const R = {
    setTimeout: window.setTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window),
    dateNow: Date.now.bind(Date),
  };
  let stepping = false;
  let vt = 0;
  const now = () => (stepping ? vt : RP());
  performance.now = now;
  const dateBase = R.dateNow() - RP();
  Date.now = () => Math.floor(dateBase + now());

  // ───────────────────────── timers
  let nextId = 1;
  const timers = new Map();
  const add = (fn, ms, args, iv) => {
    const id = nextId++;
    const d = Math.max(0, +ms || 0);
    timers.set(id, { id, due: now() + (iv ? Math.max(1, d) : d), fn, args, iv: iv ? Math.max(1, d) : 0 });
    if (!stepping) R.setTimeout(pump, d);
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  function nextDue(limit) {
    let best = null;
    for (const t of timers.values()) if (t.due <= limit && (!best || t.due < best.due || (t.due === best.due && t.id < best.id))) best = t;
    return best;
  }
  function fire(t) {
    if (t.iv) { t.due += t.iv; if (!stepping && t.due < now()) t.due = now() + t.iv; if (!stepping) R.setTimeout(pump, t.iv); }
    else timers.delete(t.id);
    try { if (typeof t.fn === 'function') t.fn(...t.args); } catch (e) { console.error('[cap timer]', e); }
  }
  function pump() {
    if (stepping) return;
    const t = nextDue(now());
    if (!t) return;
    fire(t);
    if (nextDue(now())) R.setTimeout(pump, 0);
  }

  // ───────────────────────── rAF
  let rafQ = new Map(), rafId = 1, realRafPending = false;
  window.requestAnimationFrame = (cb) => { const id = rafId++; rafQ.set(id, cb); if (!stepping) ensureRealRaf(); return id; };
  window.cancelAnimationFrame = (id) => { rafQ.delete(id); };
  function ensureRealRaf() {
    if (realRafPending) return;
    realRafPending = true;
    R.raf(() => { realRafPending = false; if (!stepping) runRaf(now()); });
  }
  function runRaf(t) {
    const q = rafQ; rafQ = new Map();
    for (const cb of q.values()) { try { cb(t); } catch (e) { console.error('[cap raf]', e); } }
  }
  const mc = new MessageChannel();
  const yieldQ = [];
  mc.port1.onmessage = () => { const r = yieldQ.shift(); if (r) r(); };
  const yieldTask = () => new Promise((r) => { yieldQ.push(r); mc.port2.postMessage(0); });

  // ───────────────────────── CSS animations
  function animTick() {
    let list = [];
    try { list = document.getAnimations(); } catch { return; }
    for (const a of list) {
      if (!a.__cap) { a.__cap = { start: vt, base: a.currentTime ?? 0 }; try { a.pause(); } catch { /* ignore */ } }
      try { a.currentTime = a.__cap.base + (vt - a.__cap.start) * (a.playbackRate || 1); } catch { /* ignore */ }
    }
  }

  // ───────────────────────── audio
  const SR = 48000;
  const audioSeconds = cfg.audioSeconds ?? 60;
  const OAC = window.OfflineAudioContext;
  const realSuspend = OAC.prototype.suspend, realResume = OAC.prototype.resume;
  let theAC = null, audioStarted = false, audioDone = null, audioPos = 0, audioDead = false;
  if (cfg.audio !== false) {
    class CapAudioContext extends OAC {
      constructor() {
        super({ numberOfChannels: 2, length: Math.ceil(audioSeconds * SR), sampleRate: SR });
        theAC = this;
      }
      get state() { return 'running'; }
      resume() { return Promise.resolve(); }
      suspend() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      get baseLatency() { return 0; }
      get outputLatency() { return 0; }
    }
    window.AudioContext = CapAudioContext;
    window.webkitAudioContext = CapAudioContext;
  }
  function renderAudioTo(sec) {
    if (!theAC || audioDead) return Promise.resolve();
    if (sec >= audioSeconds - 0.05) { audioDead = true; console.warn('[cap] audio buffer full'); return Promise.resolve(); }
    if (sec <= audioPos + 1e-4) return Promise.resolve();
    audioPos = sec;
    return new Promise((res) => {
      realSuspend.call(theAC, sec).then(res, (e) => { console.warn('[cap] suspend', e?.message); res(); });
      if (!audioStarted) { audioStarted = true; audioDone = theAC.startRendering(); }
      else realResume.call(theAC).catch(() => {});
    });
  }

  // ───────────────────────── scripted input + director
  const inp = { held: new Set(), pressed: new Set(), mHeld: new Set(), mPressed: new Set(), dx: 0, dy: 0 };
  const SENS = 0.0022;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // cheap smooth noise (sum of incommensurate sines)
  const noise = (t, s) => Math.sin(t * 1.13 + s) * 0.5 + Math.sin(t * 2.71 + s * 1.7) * 0.3 + Math.sin(t * 5.3 + s * 2.3) * 0.2;

  const ctl = {
    t: 0,               // seconds since begin()
    frame: 0,
    recording: false,
    g: null,
    // camera spring
    cam: { on: false, y: 0, p: 0, vy: 0, vp: 0, ty: 0, tp: 0, w: 7, z: 0.72, jitter: 1, target: null, lead: null },
    // walking
    walk: { on: false, pts: [], i: 0, run: false, lookAlong: true, tol: 0.35, done: null },
    perFrame: [],
    waiters: [],
    key(code, on = true) { if (on) { if (!inp.held.has(code)) inp.pressed.add(code); inp.held.add(code); } else inp.held.delete(code); },
    tap(code) { inp.pressed.add(code); },
    mouse(b, on = true) { if (on) { if (!inp.mHeld.has(b)) inp.mPressed.add(b); inp.mHeld.add(b); } else inp.mHeld.delete(b); },
    click(b = 0) { inp.mPressed.add(b); },
    /** Start steering the camera from where the player looks now. */
    grab(opts = {}) {
      const p = ctl.g.player;
      Object.assign(ctl.cam, { on: true, y: p.yaw, p: p.pitch, vy: 0, vp: 0, ty: p.yaw, tp: p.pitch, target: null }, opts);
    },
    release() { ctl.cam.on = false; },
    /** Aim at yaw/pitch in degrees (absolute). */
    aim(yawDeg, pitchDeg, opts = {}) {
      const c = ctl.cam; c.target = null;
      c.ty = c.y + wrap(yawDeg * Math.PI / 180 - c.y); c.tp = pitchDeg * Math.PI / 180;
      Object.assign(c, opts);
    },
    /** Track a point (Vector3-like or a function returning one), recomputed each frame. */
    track(target, opts = {}) { ctl.cam.target = target; Object.assign(ctl.cam, opts); },
    walkTo(pts, opts = {}) {
      return new Promise((res) => { Object.assign(ctl.walk, { on: true, pts, i: 0, run: false, lookAlong: true, tol: 0.35, done: res, until: ctl.t + (opts.timeout ?? 9) }, opts); });
    },
    stopWalk() { const w = ctl.walk; w.on = false; for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) inp.held.delete(k); if (w.done) { const d = w.done; w.done = null; d(); } },
    wait(sec) { return new Promise((res) => ctl.waiters.push({ at: ctl.t + sec, res })); },
    until(fn, maxSec = 30) { const end = ctl.t + maxSec; return new Promise((res) => ctl.waiters.push({ cond: fn, end, res })); },
    every(fn) { ctl.perFrame.push(fn); return () => { const i = ctl.perFrame.indexOf(fn); if (i >= 0) ctl.perFrame.splice(i, 1); }; },
    record(on = true) { ctl.recording = on; },
    /** Alive, awake enemies (optionally of one group), nearest first. */
    foes(group) {
      const g = ctl.g, e0 = g.player.eye;
      return g.enemies.all.filter((e) => e.alive && e.state !== 'dormant' && (!group || e.group === group))
        .sort((a, b) => a.position.distanceTo(e0) - b.position.distanceTo(e0));
    },
    aimPoint(e) {
      const y = e.type === 'skitter' ? 0.3 : e.type === 'sentry' ? 0.0 : 1.25;
      return { x: e.position.x, y: e.position.y + y, z: e.position.z };
    },
    /**
     * Fight like a player: track the nearest foe with a lagging spring, fire only when the crosshair is
     * on it (semi-auto cadence with a little irregularity), reload after `reloadAfter` shots.
     */
    async fight({ group, until, interval = 0.42, reloadAfter = 0, reloadWait = 1.6, maxTime = 20, range = 16, tol = 2.6, w = 7.5, z = 0.72, onShot } = {}) {
      const end = ctl.t + maxTime; let shots = 0, cur = null;
      while (ctl.t < end) {
        if (until && until()) break;
        const e = ctl.foes(group)[0];
        if (!e) { await ctl.wait(0.1); continue; }
        if (e !== cur) { cur = e; ctl.track(() => (cur && cur.alive ? ctl.aimPoint(cur) : null), { w, z }); await ctl.wait(0.25); }
        const p = ctl.aimPoint(e), pl = ctl.g.player;
        const ey = Math.abs(wrap(ctl.yawTo(p) - pl.yaw)) * 57.3, ep = Math.abs(ctl.pitchTo(p) - pl.pitch) * 57.3;
        const d = Math.hypot(p.x - pl.eye.x, p.z - pl.eye.z);
        const wpn = pl.weapons[pl.currentWeapon];
        if (wpn && wpn.clip === 0 && !wpn.reloading) { ctl.tap('KeyR'); await ctl.wait(reloadWait); continue; }
        if (ey < tol && ep < tol * 1.3 && d < range && wpn && !wpn.reloading) {
          ctl.click(0); shots++;
          if (onShot) onShot(shots);
          if (reloadAfter && shots === reloadAfter) { await ctl.wait(0.45); ctl.tap('KeyR'); await ctl.wait(reloadWait); continue; }
          await ctl.wait(interval * (0.85 + Math.random() * 0.35));
        } else await ctl.wait(1 / 60);
      }
      ctl.track(null);
      return shots;
    },
    yawTo(p) { const e = ctl.g.player.eye; return Math.atan2(-(p.x - e.x), -(p.z - e.z)); },
    pitchTo(p) { const e = ctl.g.player.eye; return Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); },
  };

  function driveInput(dt) {
    const g = ctl.g; if (!g) return;
    const p = g.player;
    const w = ctl.walk, c = ctl.cam;
    // walking: waypoint following with digital WASD relative to the current yaw
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) inp.held.delete(k);
    if (w.on) {
      let tgt = w.pts[w.i];
      const pos = p.position;
      while (tgt && Math.hypot(tgt[0] - pos.x, tgt[1] - pos.z) < (w.i === w.pts.length - 1 ? w.tol : 0.9)) { w.i++; tgt = w.pts[w.i]; }
      if (!tgt || ctl.t > w.until) { if (tgt) console.warn('[cap] walk timed out at', pos.x.toFixed(2), pos.z.toFixed(2)); ctl.stopWalk(); }
      else {
        const dx = tgt[0] - pos.x, dz = tgt[1] - pos.z, L = Math.hypot(dx, dz) || 1;
        const yaw = p.yaw;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const df = (dx * fx + dz * fz) / L, dr = (dx * rx + dz * rz) / L;
        if (df > 0.38) inp.held.add('KeyW'); else if (df < -0.38) inp.held.add('KeyS');
        if (dr > 0.38) inp.held.add('KeyD'); else if (dr < -0.38) inp.held.add('KeyA');
        if (w.run) inp.held.add('ShiftLeft'); else inp.held.delete('ShiftLeft');
        if (w.lookAlong && !c.target && c.on) {
          // look a little ahead along the path (eased by the camera spring)
          const nxt = w.pts[Math.min(w.i + 1, w.pts.length - 1)];
          const lx = tgt[0] * 0.7 + nxt[0] * 0.3 - pos.x, lz = tgt[1] * 0.7 + nxt[1] * 0.3 - pos.z;
          if (Math.hypot(lx, lz) > 0.5) c.ty = c.y + wrap(Math.atan2(-lx, -lz) - c.y);
          if (w.pitch !== undefined) c.tp = w.pitch * Math.PI / 180;
        }
      }
    }
    // camera: damped spring toward the target, small overshoot, hand noise
    if (c.on) {
      if (c.target) {
        const tp = typeof c.target === 'function' ? c.target() : c.target;
        if (tp) { c.ty = c.y + wrap(ctl.yawTo(tp) - c.y); c.tp = ctl.pitchTo(tp); }
      }
      const W = c.w, Z = c.z;
      const ay = W * W * (c.ty - c.y) - 2 * Z * W * c.vy;
      const ap = W * W * (c.tp - c.p) - 2 * Z * W * c.vp;
      c.vy += ay * dt; c.vp += ap * dt; c.y += c.vy * dt; c.p += c.vp * dt;
      const j = c.jitter * 0.0035;
      const ny = c.y + noise(ctl.t * 0.9, 1.3) * j, np = c.p + noise(ctl.t * 0.8, 4.1) * j * 0.8;
      inp.dx = -wrap(ny - p.yaw) / SENS;
      inp.dy = -(np - p.pitch) / SENS;
    }
  }

  async function step(dtSec = 1 / 60) {
    const dt = dtSec;
    vt += dt * 1000;
    ctl.t += dt; ctl.frame++;
    await renderAudioTo(ctl.t);
    for (const f of [...ctl.perFrame]) { try { f(ctl.t, dt); } catch (e) { console.error('[cap perFrame]', e); } }
    // resolve coroutine waits, let them run
    for (let k = 0; k < 4; k++) {
      const due = ctl.waiters.filter((w) => (w.at !== undefined ? w.at <= ctl.t + 1e-6 : (w.cond() || ctl.t >= w.end)));
      if (!due.length) break;
      ctl.waiters = ctl.waiters.filter((w) => !due.includes(w));
      for (const w of due) w.res();
      await yieldTask();
    }
    driveInput(dt);
    for (;;) { const t = nextDue(vt); if (!t) break; fire(t); await yieldTask(); }
    animTick();
    runRaf(vt);
    await yieldTask();
    animTick();
    return ctl.recording;
  }

  function attach(g) {
    ctl.g = g;
    const gi = g.input;
    Object.defineProperty(gi, 'mouseDX', { get: () => inp.dx, configurable: true });
    Object.defineProperty(gi, 'mouseDY', { get: () => inp.dy, configurable: true });
    Object.defineProperty(gi, 'wheel', { get: () => 0, configurable: true });
    Object.defineProperty(gi, 'pointerLocked', { get: () => true, configurable: true });
    gi.down = (c) => inp.held.has(c);
    gi.pressed = (c) => inp.pressed.has(c);
    gi.mouseDown = (b) => inp.mHeld.has(b);
    gi.mousePressed = (b) => inp.mPressed.has(b);
    gi.requestPointerLock = () => {};
    gi.exitPointerLock = () => {};
    gi.endFrame = () => { inp.pressed.clear(); inp.mPressed.clear(); inp.dx = 0; inp.dy = 0; };
  }

  function wavBase64(buf, fromSec, toSec) {
    const ch = buf.numberOfChannels, a = Math.max(0, Math.floor(fromSec * SR)), b = Math.min(buf.length, Math.floor(toSec * SR));
    const n = Math.max(0, b - a);
    const out = new DataView(new ArrayBuffer(44 + n * 2 * 2));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, SR, true);
    out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * 4, true);
    const L = buf.getChannelData(0), Rr = buf.getChannelData(ch > 1 ? 1 : 0);
    let o = 44;
    for (let i = a; i < b; i++) {
      out.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); o += 2;
      out.setInt16(o, Math.max(-1, Math.min(1, Rr[i])) * 32767, true); o += 2;
    }
    const bytes = new Uint8Array(out.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  window.__cap = {
    ctl,
    get stepping() { return stepping; },
    get vt() { return vt; },
    begin() { if (stepping) return; vt = RP(); stepping = true; },
    step,
    attach,
    async finishAudio(fromSec, toSec) {
      if (!theAC) return null;
      if (!audioStarted) { audioStarted = true; audioDone = theAC.startRendering(); }
      else if (!audioDead) realResume.call(theAC).catch(() => {});
      const buf = await audioDone;
      return wavBase64(buf, fromSec, toSec);
    },
  };
})();
