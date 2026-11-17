// Enemy navigation check (stage 3a §8.10, nav v2 — two decks).
// Boots the two-deck dev greybox (`?greybox=deck2`) and levels 1–2 headless (like check-reach) and, per level:
//   static  — every nav node stands on walkable floor (ray down: floor 0 … 0.3 m under the node) and inside its room;
//             every declared floor (room floor + extra floors) keeps reachable nodes (an unlinked deck fails);
//             every link is walked by a real husk capsule (ctx.physics.moveBody, doors open), drops one way;
//             per story phase (the level's phase table): every goal region of the player holds nav nodes connected
//             to the phase's start through the doors that phase leaves passable (enemies can follow the player).
//   dynamic — real husks (enemies.spawn, real AI, real physics; the game loop stepped in page at 60 Hz, no teleports)
//             reach a player standing elsewhere — on the other deck in the greybox — within a time bound and attack;
//             they never end up under a floor, outside every room, or stuck (no 0.3 m of progress for 4 s); a husk
//             with the player out of reach stands off and comes once the door opens; a sentry finds a player on the
//             other deck; on the ramp a standing husk / player drifts < 5 cm in 10 s (the same with the physics slope
//             hold switched off must FAIL), and the player and a husk walk it up and down 5 times without going over
//             its open side.
// Deliberate failing cases (greybox): an island deck no stair links (static: unlinked floor; dynamic: a husk on it
// never reaches the player), and the drift case without the slope hold. They print "ok … [EXPECTED FAIL …]" when
// they fail as they must, FAIL when they pass.
// Levels 1–2 print their nav node hash and build time (nav v2 must leave both unchanged).
//
// Level 4 (stage 3b §10.3) declares its own cases like level 3, with `sentries` (a list) besides `sentry`.
// Usage: node scripts/check-nav.mjs [--url http://127.0.0.1:5173] [--level 1|2|3|4|all|greybox] [--no-sim] [--verbose]
// Exit code 1 on any failure.
import { parseArgs, launch, bootLevel } from './lib/check-common.mjs';

const args = parseArgs();
const base = args.url ?? 'http://127.0.0.1:5173';
const which = args.level ?? 'all';
const targets = which === 'all' ? ['greybox', 1, 2, 3, 4] : which === 'greybox' ? ['greybox'] : [Number(which)];
const sims = !args['no-sim'];
/**
 * Levels 1–2 nav node sets as built before nav v2 (K4 baseline: ids, positions, rooms, links). Nav v2 must not change
 * them; if a deliberate level-1/2 edit changes the graph, update the hash here (the check prints the new one).
 */
const BASELINE_HASH = { 1: 'b269745d', 2: '2bd8f22e' };

/** In page: helpers shared by every case (window.__nav). */
function install() {
  const g = window.__game, level = g.level, phys = g.physics;
  const V = g.camera.position.constructor;
  const DT = 1 / 60;
  const nav = level.nav;
  const info = level.root.userData.nav ?? null;
  const stairs = info?.stairs ?? [];
  const DOWN = new V(0, -1, 0);
  const floorOfRoom = (r) => (typeof r.floor === 'number' ? r.floor : r.bounds.min.y + 0.5);
  const stairH = (s, x, z, r = 0) => {
    const dx = s.b[0] - s.a[0], dz = s.b[2] - s.a[2], l2 = dx * dx + dz * dz;
    const t = ((x - s.a[0]) * dx + (z - s.a[2]) * dz) / l2;
    if (t < 0 || t > 1) return null;
    const lat = Math.abs((x - s.a[0]) * dz - (z - s.a[2]) * dx) / Math.sqrt(l2);
    if (lat > s.width / 2 + r) return null;
    return s.a[1] + t * (s.b[1] - s.a[1]);
  };
  /** Every walkable surface height over (x, z): room floors, extra floors, stair slopes. */
  const floorsAt = (x, z, grow = 0.4) => {
    const out = [];
    for (const r of level.rooms) {
      const b = r.bounds;
      if (x < b.min.x - grow || x > b.max.x + grow || z < b.min.z - grow || z > b.max.z + grow) continue;
      out.push(floorOfRoom(r));
      // (a capsule stands on a slab edge with its centre up to its radius out)
      for (const f of r.floors ?? []) if (x >= f.box[0] - 0.4 && x <= f.box[1] + 0.4 && z >= f.box[2] - 0.4 && z <= f.box[3] + 0.4) out.push(f.y);
    }
    for (const s of stairs) { const h = stairH(s, x, z, 0.1); if (h !== null) out.push(h); }
    return out;
  };
  const inAnyRoom = (x, z, grow = 0.45) => level.rooms.some((r) => x >= r.bounds.min.x - grow && x <= r.bounds.max.x + grow && z >= r.bounds.min.z - grow && z <= r.bounds.max.z + grow);
  const openAll = () => { for (const d of level.doors) { d.setStatus?.(null); d.unlock(); d.auto = true; d.open(); d.snap?.(); } };
  /** Links governed by a door, as enemies/nav.ts decides it (decks: average link y within 2 m of the door's floor). */
  const decks = !!info?.decks;
  const segXZ = (p, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    let t = l2 > 1e-8 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0;
    t = Math.min(1, Math.max(0, t));
    return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
  };
  const doorOf = (a, b) => {
    const ly = decks ? (a.position.y + b.position.y) / 2 : a.position.y;
    for (const d of level.doors) if (segXZ(d.position, a.position, b.position) < 0.9 && Math.abs(d.position.y - ly) < (decks ? 2 : 2.5)) return d;
    return null;
  };
  const nearestNode = (p) => {
    let best = -1, bd = Infinity;
    for (const n of nav) { const q = n.position, dy = q.y - p.y; const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + dy * dy * 4; if (d < bd) { bd = d; best = n.id; } }
    return best;
  };
  /** Dijkstra over the graph (drops one way); `pass(a, b)` filters links. Returns dist array. */
  const dijkstra = (start, pass = () => true) => {
    const dist = new Float64Array(nav.length).fill(Infinity), done = new Uint8Array(nav.length);
    dist[start] = 0;
    for (;;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < nav.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      const a = nav[u];
      for (const l of [...a.links, ...(a.drops ?? [])]) {
        const b = nav[l];
        if (!pass(a, b)) continue;
        const d = bd + a.position.distanceTo(b.position);
        if (d < dist[l]) dist[l] = d;
      }
    }
    return dist;
  };
  const hash = () => {
    let h = 2166136261;
    const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (const n of nav) mix(`${n.id}:${n.position.x.toFixed(4)},${n.position.y.toFixed(4)},${n.position.z.toFixed(4)}:${n.room}:${[...n.links].sort((a, b) => a - b).join(',')}|`);
    return h.toString(16);
  };

  // ── stepping the real game loop (player, level, enemies) at 60 Hz, synchronously ──
  let enemyMs = 0, enemyFrames = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      g.time += DT;
      g.player.update(DT);
      level.update(DT);
      const t0 = performance.now();
      g.enemies.update(DT);
      enemyMs += performance.now() - t0; enemyFrames++;
    }
  };
  const place = (p, yaw = 0) => { g.player.teleport(new V(p[0], p[1] + 0.05, p[2]), yaw, 0); g.player.debug.move(0, 0, false); step(20); };
  const attacks = new Map();
  g.events.on('enemy:attack', (e) => { if (!attacks.has(e.id)) attacks.set(e.id, []); attacks.get(e.id).push({ t: g.time, kind: e.kind }); });
  let groupN = 0;
  const spawn = (type, p, yaw = 0) => {
    const grp = `navtest_${++groupN}`;
    const e = g.enemies.spawn(type, new V(p[0], p[1] + 0.02, p[2]), yaw, grp);
    return { e, grp };
  };
  const kill = (grp) => { try { g.enemies.removeGroup(grp); } catch { /* */ } step(2); };
  const o3f = new V();
  const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

  /**
   * Follow one enemy until it attacks (or the time is up). Tracks: under a floor / off every floor (grounded with
   * no floor within 0.4 m), outside every room, stuck (< 0.3 m in 4 s while not attacking), stair / drop use.
   */
  const follow = (e, within, o = {}) => {
    const t0 = g.time, p = e.position;
    const r = { reached: false, t: 0, under: null, outside: null, stuck: null, offFloor: null, stair: false, drop: false, end: '' };
    let mark = p.clone(), markT = g.time, outT = 0, lastAttack = (attacks.get(e.id) ?? []).length;
    const hist = [];
    while (g.time - t0 < within) {
      step(1);
      if (!e.alive) { r.end = 'died'; break; }
      if (e.state === 'idle' && ((g.time - t0) * 60 | 0) % 60 === 0) e.alert?.(); // (as the story's `rouse` does, every second)
      const fl = floorsAt(p.x, p.z);
      const at = () => `${fmt(p)} at ${(g.time - t0).toFixed(1)} s`;
      if (e.type === 'husk') {
        if (fl.length) {
          if (p.y < Math.min(...fl) - 0.3) r.under ??= at();
          if (e.body.onGround && !fl.some((f) => Math.abs(f - p.y) < 0.4)) r.offFloor ??= at();
        } else if (e.body.onGround) {
          // (outside every room — levels 1–2 have passages that are not rooms): physical floor right under the feet
          o3f.set(p.x, p.y + 0.3, p.z);
          if (!phys.raycast(o3f, DOWN, 0.8)) r.under ??= at();
        }
      }
      if (!inAnyRoom(p.x, p.z)) {
        outT += DT;
        // multi-deck levels: every walkable place must be a room / floor (nav v2 depends on it); levels 1–2: a note
        if (outT > 0.5) { if (decks) r.outside ??= at(); else r.passage ??= at(); }
      } else outT = 0;
      for (const s of stairs) { const h = stairH(s, p.x, p.z); if (h !== null && Math.abs(h - p.y) < 0.4 && h > s.a[1] + 0.6 && h < s.b[1] - 0.6) r.stair = true; }
      hist.push([g.time, p.y]);
      while (hist.length && hist[0][0] < g.time - 1.5) hist.shift();
      if (hist.length && hist[0][1] - p.y > 2.5) r.drop = true;
      const atk = attacks.get(e.id) ?? [];
      if (atk.length > lastAttack && (!o.kind || atk.slice(lastAttack).some((a) => a.kind === o.kind))) { r.reached = true; r.t = g.time - t0; break; }
      if (o.until && o.until()) { r.reached = true; r.t = g.time - t0; break; }
      if (g.time - markT >= 4) {
        if (p.distanceTo(mark) < 0.3 && !o.noStuck) r.stuck ??= `${fmt(p)} at ${(g.time - t0).toFixed(1)} s`;
        mark.copy(p); markT = g.time;
      }
    }
    r.at = fmt(p);
    return r;
  };

  window.__nav = {
    hash, V,
    statics(o) {
      openAll();
      const out = { nodes: nav.length, links: nav.reduce((s, n) => s + n.links.length, 0) / 2, drops: nav.reduce((s, n) => s + (n.drops?.length ?? 0), 0), hash: hash(), decks, offFloor: [], raised: [], outRoom: [], passage: [], badLinks: [], linkN: 0, floors: info?.floors ?? null, stairs: stairs.length, stats: level.root.userData.stats };
      const o3 = new V();
      for (const n of nav) {
        const q = n.position;
        o3.set(q.x, q.y + 0.5, q.z);
        const h = phys.raycast(o3, DOWN, 1.0);
        // nav v2 levels: the node is ON its floor (0 … 0.3 m above it); levels 1–2 (every node at y 0) also accept a
        // floor up to 0.3 m above the node (raised plates, the line's apron: a husk steps onto them)
        // (deck levels: up to 0.2 m above, a 0.15 m walkable body box lying on the node — units step over it)
        const lo = decks ? -0.2 : -0.3;
        if (h && !decks && q.y - h.point.y < -0.1 && q.y - h.point.y >= lo) out.raised.push(`#${n.id} ${n.room} ${fmt(q)}: floor at ${h.point.y.toFixed(2)}`);
        if (!h || h.normal.y < 0.5 || q.y - h.point.y > 0.3 || q.y - h.point.y < lo) out.offFloor.push(`#${n.id} ${n.room}${n.stair ? ' stair' : ''} ${fmt(q)}: ${h ? `floor at ${h.point.y.toFixed(2)}` : 'no floor within 0.5 m'}`);
        const r = level.rooms.find((x) => x.id === n.room);
        const b = r?.bounds, e = 0.3;
        if (!b || q.x < b.min.x - e || q.x > b.max.x + e || q.z < b.min.z - e || q.z > b.max.z + e || q.y < b.min.y - 0.05 || q.y > b.max.y) {
          // levels 1–2: hand-placed nodes in passages that are not rooms (on a physical floor, checked above) are a note
          (decks || inAnyRoom(q.x, q.z, 0.3) ? out.outRoom : out.passage).push(`#${n.id} ${n.room} ${fmt(q)}`);
        }
      }
      // every link walked by a husk capsule (low → high end; drops from → to)
      const body = { position: new V(), velocity: new V(), radius: 0.35, height: 1.8, onGround: false, gravityScale: 1 };
      const walk = (a, b, drop) => {
        body.position.copy(a.position); body.position.y += 0.02; body.velocity.set(0, 0, 0); body.onGround = true;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z, hl = Math.hypot(dx, dz);
        if (hl < 1e-3) return true;
        const sp = 2.5, T = (hl / sp) * 2.5 + 1.5;
        for (let t = 0; t < T; t += DT) {
          const ex = b.position.x - body.position.x, ez = b.position.z - body.position.z, el = Math.hypot(ex, ez);
          if (el < 0.25 && Math.abs(body.position.y - b.position.y) < 0.5 && body.onGround) return true;
          const k = el > 1e-3 ? sp / el : 0;
          body.velocity.x = ex * k; body.velocity.z = ez * k;
          if (body.onGround && body.velocity.y <= 0) body.velocity.y = -2;
          phys.moveBody(body, DT);
        }
        return drop ? Math.hypot(b.position.x - body.position.x, b.position.z - body.position.z) < 1.0 && Math.abs(body.position.y - b.position.y) < 0.35 : false;
      };
      for (const a of nav) {
        for (const l of a.links) {
          if (l < a.id) continue;
          const b = nav[l];
          const [lo, hi] = a.position.y <= b.position.y ? [a, b] : [b, a];
          out.linkN++;
          if (!walk(lo, hi, false)) out.badLinks.push(`#${lo.id} ${fmt(lo.position)} → #${hi.id} ${fmt(hi.position)} (${lo.room}${lo.stair || hi.stair ? ', stair' : ''}): stopped at ${fmt(body.position)}`);
        }
        for (const l of a.drops ?? []) { out.linkN++; if (!walk(a, nav[l], true)) out.badLinks.push(`drop #${a.id} ${fmt(a.position)} → #${l} ${fmt(nav[l].position)}: ended at ${fmt(body.position)}`); }
      }
      return out;
    },
    /** Per phase: the player's goal regions hold nav nodes connected to the phase start through passable doors. */
    phases() {
      const res = [];
      for (const ph of (level.phases ?? []).filter((p) => p.check && p.check.expect !== 'fail')) {
        level.applyPhase(ph.id, { snap: true });
        const start = nearestNode(new V(...ph.check.start));
        const dist = dijkstra(start, (a, b) => { const d = doorOf(a, b); return !d || !(d.locked && !d.isOpen); });
        const goals = [];
        for (const reg of ph.check.goal) {
          const boxes = level.regions[reg];
          if (!boxes) { goals.push({ reg, state: 'n/a' }); continue; }
          const inReg = nav.filter((n) => boxes.some((b) => b.containsPoint(new V(n.position.x, n.position.y + 0.9, n.position.z))));
          if (!inReg.length) { goals.push({ reg, state: 'no nodes' }); continue; }
          const ok = inReg.filter((n) => dist[n.id] < Infinity).length;
          goals.push({ reg, state: ok ? 'ok' : 'cut', ok, of: inReg.length });
        }
        res.push({ id: ph.id, label: ph.label, start, goals });
      }
      openAll();
      return res;
    },
    /** Levels 1–2: husk cases between nav nodes 12–30 m apart along a path that passes no door (seeded). */
    autoCases(n) {
      openAll();
      let seed = 1234567;
      const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
      const cases = [];
      for (let tries = 0; tries < 400 && cases.length < n; tries++) {
        const a = nav[(rnd() * nav.length) | 0];
        if (a.stair) continue;
        const dist = dijkstra(a.id, (x, y) => !doorOf(x, y));
        const cand = nav.filter((b) => dist[b.id] > 12 && dist[b.id] < 30 && !b.stair && Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z) > 8);
        if (!cand.length) continue;
        const b = cand[(rnd() * cand.length) | 0];
        if (cases.some((c) => c.roomA === a.room && c.roomB === b.room)) continue;
        cases.push({ id: `${a.room}→${b.room}`, label: `husk ${a.room} ${fmt(a.position)} → player ${b.room} ${fmt(b.position)} (path ${dist[b.id].toFixed(1)} m)`, spawn: a.position.toArray(), player: b.position.toArray(), within: Math.ceil(dist[b.id] / 1.0 + 12), roomA: a.room, roomB: b.room });
      }
      return cases;
    },
    /** A husk walks to the player and attacks. */
    reach(c) {
      openAll();
      if (c.phase) level.applyPhase(c.phase, { snap: true });
      const yaw = Math.atan2(-(c.spawn[0] - c.player[0]), -(c.spawn[2] - c.player[2]));
      place(c.player, yaw);
      const { e, grp } = spawn('husk', c.spawn, Math.atan2(-(c.player[0] - c.spawn[0]), -(c.player[2] - c.spawn[2])));
      step(2); e.alert?.();
      const r = follow(e, c.within);
      kill(grp);
      return r;
    },
    /** Player out of reach behind a locked door: stand off (no attack, no wandering, never under a floor), then come. */
    standOff(c) {
      openAll();
      const d = level.door(c.door);
      d.close(); d.snap?.(); d.lock();
      place(c.player, 0);
      const { e, grp } = spawn('husk', c.spawn, 0);
      step(2); e.alert?.();
      const a = follow(e, c.hold, { noStuck: true, until: () => false });
      const held = e.position.clone();
      const b0 = e.position.clone();
      const quiet = follow(e, 4, { noStuck: true, until: () => false });
      const wander = e.position.distanceTo(b0);
      const stood = fmt(held);
      d.unlock(); d.auto = true;
      const c2 = follow(e, c.within);
      kill(grp);
      openAll();
      return { held: a, attackedWhileLocked: a.reached || quiet.reached, wander, stood, state: e.state, come: c2 };
    },
    sentry(c) {
      openAll();
      place(c.player, 0);
      const { e, grp } = spawn('sentry', c.spawn, 0);
      step(2); e.alert?.(); e.wake?.(0);
      const r = follow(e, c.within, { kind: 'ranged' });
      kill(grp);
      return r;
    },
    /** Ramp: idle drift of a husk / the player, then 5 walks up and down (player input; husk following the player). */
    ramp(c, opts = {}) {
      openAll();
      const s = stairs[c.stair];
      const out = {};
      const hold = phys._holdSlopes;
      if (opts.noHold) phys._holdSlopes = false;
      try {
        // the player out of sight (in a far corner, facing away) so the husk stays idle
        place(c.away, 0);
        for (const d of level.doors) { d.close(); d.snap?.(); d.lock(); }
        const { e, grp } = spawn('husk', c.standAt, 0);
        step(60);
        const p0 = e.position.clone();
        step(600);
        out.huskDrift = Math.hypot(e.position.x - p0.x, e.position.z - p0.z);
        out.huskState = e.state;
        kill(grp);
        if (opts.noHold) return out;
        place(c.standAt, 0);
        step(30);
        const q0 = g.player.position.clone();
        step(600);
        out.playerDrift = Math.hypot(g.player.position.x - q0.x, g.player.position.z - q0.z);
      } finally { phys._holdSlopes = hold; openAll(); }
      // walks: watch the body while over the ramp's footprint — it must stay on the slope (never below it)
      const watch = (p, acc) => { const h = stairH(s, p.x, p.z, -0.05); if (h !== null && p.y < h - 0.45) acc.fell ??= fmt(p); if (h !== null) acc.on = true; if (!inAnyRoom(p.x, p.z)) acc.fell ??= fmt(p); };
      const dirUp = Math.atan2(-(s.b[0] - s.a[0]), -(s.b[2] - s.a[2]));
      const walkLeg = (from, to, yaw, acc) => {
        g.player.teleport(new V(from[0], from[1] + 0.05, from[2]), yaw, 0);
        step(10);
        g.player.debug.move(1, 0, false);
        let ok = false;
        for (let t = 0; t < 10; t += DT) {
          step(1);
          watch(g.player.position, acc);
          const p = g.player.position;
          if (Math.hypot(p.x - to[0], p.z - to[2]) < 0.6 && Math.abs(p.y - to[1]) < 0.3) { ok = true; break; }
        }
        g.player.debug.move(0, 0, false);
        step(5);
        return ok;
      };
      const pAcc = {};
      let pLegs = 0;
      for (let i = 0; i < c.trips; i++) {
        if (walkLeg(c.bottom, c.top, dirUp, pAcc)) pLegs++;
        if (walkLeg(c.top, c.bottom, dirUp + Math.PI, pAcc)) pLegs++;
      }
      out.playerLegs = pLegs; out.playerFell = pAcc.fell ?? null; out.playerOn = !!pAcc.on;
      // a husk follows the player up and down
      place(c.bottom, 0);
      const { e, grp } = spawn('husk', c.bottom, 0);
      step(2); e.alert?.();
      const hAcc = {};
      let hLegs = 0;
      for (let i = 0; i < c.trips * 2; i++) {
        const to = i % 2 === 0 ? c.top : c.bottom;
        place(to, 0);
        let ok = false;
        for (let t = 0; t < 20; t += DT) {
          step(1);
          watch(e.position, hAcc);
          const p = e.position, q = g.player.position;
          if (Math.hypot(p.x - q.x, p.z - q.z) < 1.6 && Math.abs(p.y - q.y) < 0.6) { ok = true; break; }
        }
        if (ok) hLegs++;
      }
      kill(grp);
      out.huskLegs = hLegs; out.huskFell = hAcc.fell ?? null; out.huskOn = !!hAcc.on;
      return out;
    },
    perf() { const r = { enemyMsPerFrame: enemyFrames ? enemyMs / enemyFrames : 0, frames: enemyFrames }; enemyMs = 0; enemyFrames = 0; return r; },
  };
  g.debug.noEnemies = false; // boot without the level's own machines, then let ours hunt (EnemyManager reads it per frame)
  g.debug.god = true;
  return { nodes: nav.length, decks, hasInfo: !!info };
}

const browser = await launch();
let failures = 0;
const line = (ok, text, note = '') => { if (!ok) failures++; console.log(`${ok ? ' ok ' : 'FAIL'} ${text}${note}`); };
const expectFail = (failed, text) => {
  // a deliberate failing case: "ok" only when it fails
  if (!failed) failures++;
  console.log(`${failed ? ' ok ' : 'FAIL'} ${text}  [EXPECTED FAIL: ${failed ? 'failed as it must' : 'it PASSED — the check cannot see this failure'}]`);
};
const show = (list, n = 6) => { for (const s of list.slice(0, args.verbose ? 1e9 : n)) console.log(`       ${s}`); if (list.length > n && !args.verbose) console.log(`       … ${list.length - n} more (--verbose)`); };

for (const target of targets) {
  const greybox = target === 'greybox';
  const logs = [];
  const page = await bootLevel(browser, base, greybox ? 1 : target, { query: `&debug=1${greybox ? '&greybox=deck2' : ''}`, settle: 1500 });
  page.on('console', (m) => logs.push(m.text()));
  const boot = await page.evaluate(install);
  const timing = await page.evaluate(() => (window.__game.level.root.userData.stats ?? null));
  console.log(`\n=== NAV ${greybox ? 'greybox deck2' : `level ${target}`}: ${boot.nodes} nodes, multi-deck rules ${boot.decks ? 'ON' : 'off'} ===`);
  const st = await page.evaluate(() => window.__nav.statics());
  const navMs = await page.evaluate(() => window.__game.level.root.userData.nav?.ms ?? null);
  console.log(`      ${st.nodes} nodes, ${st.links} links${navMs !== null ? `; graph built in ${navMs.toFixed(1)} ms` : ''}; level built in ${Math.round(st.stats?.ms ?? 0)} ms`);
  if (!greybox && BASELINE_HASH[target]) line(st.hash === BASELINE_HASH[target], `level ${target} nav node set unchanged by nav v2 (hash ${st.hash}${st.hash === BASELINE_HASH[target] ? '' : `, baseline ${BASELINE_HASH[target]}`})`);
  line(st.offFloor.length === 0, `every node (${st.nodes}) stands on walkable floor (0 … 0.3 m under it)`, st.offFloor.length ? ` — ${st.offFloor.length} off the floor` : '');
  show(st.offFloor);
  line(st.outRoom.length === 0, `every node is inside its room`, st.outRoom.length ? ` — ${st.outRoom.length} outside` : '');
  show(st.outRoom);
  if (st.raised.length) { console.log(`      note: ${st.raised.length} node(s) under a raised floor plate (≤ 0.3 m; levels 1–2 build every node at y 0):`); show(st.raised, 3); }
  if (st.passage.length) { console.log(`      note: ${st.passage.length} hand-placed node(s) in passages that are not rooms (on physical floor):`); show(st.passage, 3); }
  line(st.badLinks.length === 0, `every link (${st.linkN}${st.drops ? `, ${st.drops} drop` : ''}) is walked by a husk capsule`, st.badLinks.length ? ` — ${st.badLinks.length} not` : '');
  show(st.badLinks);
  if (st.floors) {
    const cases = await page.evaluate(() => window.__game.level.navCases ?? null);
    const expected = new Set(cases?.unlinkedFloors ?? []), ignore = new Set(cases?.ignoreFloors ?? []);
    const lost = Object.entries(st.floors).filter(([k, f]) => f.kept === 0 && !k.endsWith(':stair') && !ignore.has(k));
    const bad = lost.filter(([k]) => !expected.has(k));
    line(bad.length === 0, `every declared floor keeps reachable nav nodes (${Object.keys(st.floors).length} floors, ${st.stairs} stair(s))`, bad.length ? ` — unlinked: ${bad.map(([k, f]) => `${k} (y ${f.y}, ${f.made} nodes made)`).join(', ')}` : '');
    for (const k of expected) expectFail(lost.some(([q]) => q === k), `unlinked deck "${k}" is reported`);
    if (ignore.size) console.log(`      (not part of the walkable test layout: ${[...ignore].join(', ')})`);
  }
  const ph = await page.evaluate(() => window.__nav.phases());
  for (const p of ph) {
    const cut = p.goals.filter((x) => x.state === 'cut');
    const nn = p.goals.filter((x) => x.state === 'no nodes' || x.state === 'n/a').map((x) => x.reg);
    line(cut.length === 0, `phase ${p.id.padEnd(9)} enemies can follow the player to every goal region`, `${cut.length ? ` — cut off: ${cut.map((x) => x.reg).join(', ')}` : ''}${nn.length ? `  (no nav in: ${nn.join(', ')})` : ''}`);
  }

  if (sims) {
    // a level that declares its own cases (the greybox, level 3) runs those; levels 1–2 get seeded random ones
    const own = await page.evaluate(() => window.__game.level.navCases ?? null);
    const cases = own ?? { reach: await page.evaluate(() => window.__nav.autoCases(4)) };
    for (const c of cases.reach) {
      const r = await page.evaluate((c) => window.__nav.reach(c), c);
      const vias = (c.via ?? []).filter((v) => !r[v]);
      const strict = greybox || boot.decks;
      const bad = !r.reached || r.under || r.outside || r.stuck || (strict && r.offFloor) || vias.length;
      const why = [!r.reached && `did not attack within ${c.within} s (ended at ${r.at}${r.end ? ', ' + r.end : ''})`, r.under && `under the floor ${r.under}`, r.outside && `outside every room ${r.outside}`,
        r.stuck && `stuck ${r.stuck}`, strict && r.offFloor && `standing off any floor ${r.offFloor}`, vias.length && `route did not use: ${vias.join(', ')}`].filter(Boolean);
      const text = `${c.id.padEnd(18)} ${c.label} — ${r.reached ? `attacked after ${r.t.toFixed(1)} s` : 'NOT reached'}${r.stair ? ', via stair' : ''}${r.drop ? ', via drop' : ''}`;
      if (c.expect === 'fail') expectFail(!!bad, `${text}${bad ? ` (${why[0]})` : ''}`);
      else { line(!bad, text); for (const w of why) console.log(`       ${w}`); }
      if (!greybox && r.offFloor && args.verbose) console.log(`       (note: stood off the room floor ${r.offFloor} — furniture)`);
      if (r.passage) console.log(`       (note: walked a passage that is not a room, ${r.passage})`);
    }
    if (cases.standOff) {
      const c = cases.standOff;
      const r = await page.evaluate((c) => window.__nav.standOff(c), c);
      const okHold = !r.attackedWhileLocked && r.wander < 0.6 && !r.held.under && !r.held.outside && !r.held.offFloor;
      line(okHold, `${c.id.padEnd(18)} ${c.label} — held at ${r.stood} (moved ${r.wander.toFixed(2)} m in 4 s, state ${r.state})`);
      if (r.attackedWhileLocked) console.log('       attacked through the locked door');
      for (const k of ['under', 'outside', 'offFloor']) if (r.held[k]) console.log(`       ${k}: ${r.held[k]}`);
      const cm = r.come;
      line(cm.reached && !cm.under && !cm.outside && !cm.stuck, `${''.padEnd(18)} … door unlocked: ${cm.reached ? `attacked after ${cm.t.toFixed(1)} s` : `NOT reached in ${c.within} s (at ${cm.at})`}${cm.stuck ? `, stuck ${cm.stuck}` : ''}`);
    }
    for (const c of [...(cases.sentry ? [cases.sentry] : []), ...(cases.sentries ?? [])]) {
      const r = await page.evaluate((c) => window.__nav.sentry(c), c);
      line(r.reached && !r.outside, `${c.id.padEnd(18)} ${c.label} — ${r.reached ? `fired after ${r.t.toFixed(1)} s` : `did not fire in ${c.within} s (at ${r.at})`}`);
    }
    if (cases.ramp) {
      const c = { ...cases.ramp, away: cases.ramp.away ?? [0, 0, -34] };
      const r = await page.evaluate((c) => window.__nav.ramp(c), c);
      line(r.huskDrift < 0.05, `ramp: a husk standing on it drifts ${(r.huskDrift * 100).toFixed(1)} cm in 10 s (< 5 cm; state ${r.huskState})`);
      line(r.playerDrift < 0.05, `ramp: the player standing on it drifts ${(r.playerDrift * 100).toFixed(1)} cm in 10 s (< 5 cm)`);
      line(r.playerLegs === c.trips * 2 && !r.playerFell && r.playerOn, `ramp: the player walks it up and down ${c.trips} times — ${r.playerLegs}/${c.trips * 2} legs${r.playerFell ? `, went over the side at ${r.playerFell}` : ''}`);
      line(r.huskLegs === c.trips * 2 && !r.huskFell && r.huskOn, `ramp: a husk follows the player up and down ${c.trips} times — ${r.huskLegs}/${c.trips * 2} legs${r.huskFell ? `, went over the side at ${r.huskFell}` : ''}`);
      const nh = await page.evaluate((c) => window.__nav.ramp(c, { noHold: true }), c);
      expectFail(nh.huskDrift >= 0.05, `ramp without the physics slope hold: a standing husk drifts ${(nh.huskDrift * 100).toFixed(1)} cm in 10 s`);
    }
    const perf = await page.evaluate(() => window.__nav.perf());
    console.log(`      enemies.update: ${perf.enemyMsPerFrame.toFixed(3)} ms per frame on average over ${perf.frames} simulated frames (1 machine)`);
  }
  const warn = logs.filter((l) => /nav:|pageerror|Error/.test(l));
  if (warn.length && args.verbose) for (const w of warn.slice(0, 10)) console.log(`      [console] ${w.slice(0, 200)}`);
  await page.close();
}
await browser.close();
console.log(failures ? `\nNAV: ${failures} failure(s)` : '\nNAV: all cases pass');
process.exit(failures ? 1 : 0);
