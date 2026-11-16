// Demo shot scripts. Each `run` is stringified and executed INSIDE the page (after __cap.begin()), as a
// coroutine on the stepped clock: ctl.wait(sec), ctl.until(fn), ctl.aim(yawDeg, pitchDeg), ctl.track(pt),
// ctl.walkTo([[x,z],...]), ctl.tap('KeyE'), ctl.mouse(0, true/false), ctl.record(on), mark(name).
// Yaw: 0 faces -Z, +90 faces -X (the game's convention). Positions: docs/DESIGN.md.

/** Replace the menu + intro cards: menu resolves when the capture starts; the intro becomes the title card. */
const TITLE_INIT = `(() => {
  let game;
  Object.defineProperty(window, '__game', { configurable: true, get() { return game; }, set(g) {
    game = g;
    let ui;
    Object.defineProperty(g, 'ui', { configurable: true, enumerable: true, get() { return ui; }, set(u) {
      ui = u;
      u.showMenu = () => new Promise((r) => { window.__capMenuGo = r; });
      const card = u.showCard.bind(u);
      u.showCard = (lines, opts = {}) => {
        if (lines[0] === 'ERIDU DEEP FABRICATION COMPLEX') return card(['COLD BOOT'], { style: 'title', skippable: false, seconds: 3.6 });
        return card(lines, { ...opts, skippable: false, seconds: 2.6 });
      };
    } });
  } });
})();`;

const lightOn = (save) => { save.player.flashlight = true; };

export const SHOTS = [
  {
    name: 'A',
    title: 'title card → wake in Medical 3-A → flashlight → scares → terminal → corridor',
    query: 'quality=ultra&god=1',
    init: TITLE_INIT,
    audioSeconds: 110,
    maxSeconds: 100,
    async run({ g, ctl, mark, V }) {
      const beats = () => g.story.debugState?.beats ?? [];
      window.__capMenuGo();
      await ctl.wait(1.2);
      ctl.record(true);
      mark('cards');
      await ctl.until(() => g.state === 'cutscene' && document.querySelector('.cb .card') === null, 30);
      mark('wake');
      await ctl.until(() => g.state === 'playing' && g.player.controlsEnabled, 40);
      mark('playing');
      ctl.grab({ w: 4.5, z: 0.8 });
      await ctl.wait(0.7);
      ctl.tap('KeyF');
      mark('flashlight');
      await ctl.wait(0.5);
      ctl.aim(28, -14, { w: 3.2 });
      await ctl.wait(1.3);
      // into the curtained bay with the sheeted body: the flat monitor, then the arm
      const BAY = { x: -4.0, y: 0.95, z: 4.7 };
      const toBay = ctl.walkTo([[-0.6, 5.7], [-1.25, 4.75]], { pitch: -8 });
      await ctl.wait(0.9);
      ctl.track(BAY, { w: 2.6, z: 0.85 });
      await toBay;
      await ctl.until(() => { g.story.hurry(); return beats().includes('#med_monitor_spike'); }, 12);
      mark('monitor');
      await ctl.wait(0.25);
      ctl.track({ x: -4.6, y: 1.3, z: 5.2 }, { w: 5.5, z: 0.7 });
      await ctl.wait(2.2);
      ctl.track(BAY, { w: 3, z: 0.85 });
      g.story.hurry();
      await ctl.walkTo([[-1.45, 4.0]], { lookAlong: false, tol: 0.5, timeout: 3 });
      await ctl.until(() => { g.story.hurry(); return beats().includes('#med_arm_drop'); }, 10);
      mark('arm');
      await ctl.wait(0.2);
      ctl.track({ x: -4.0, y: 0.55, z: 4.85 }, { w: 6, z: 0.72 });
      await ctl.wait(2.4);
      ctl.track(null); ctl.aim(-50, -6, { w: 3.0 });
      await ctl.wait(0.3);
      // (cut in the edit) — continue from just in front of the terminal
      mark('arm-out');
      g.player.teleport(V(0.6, 0, 2.6), -0.35, -0.08);
      ctl.grab({ w: 4, z: 0.85 });
      await ctl.walkTo([[1.2, 1.4]], { pitch: -4, timeout: 4 });
      ctl.track({ x: 1.75, y: 1.36, z: 0.38 }, { w: 4, z: 0.85 });
      await ctl.until(() => g.player.focus?.id === 'log_med', 3);
      await ctl.wait(0.25);
      if (g.player.focus?.id === 'log_med') ctl.tap('KeyE'); else { console.warn('[shot] terminal not in focus', g.player.position.x, g.player.position.z); g.interactables.use(g.interactables.get('log_med')); }
      mark('note');
      await ctl.wait(3.8);
      ctl.tap('KeyE');
      ctl.track(null);
      await ctl.wait(0.4);
      ctl.aim(8, -3, { w: 3 });
      mark('to-corridor');
      await ctl.walkTo([[0.4, 0.4], [0.05, -1.4], [0, -3.4]], { pitch: -2 });
      ctl.aim(0, 1.5, { w: 3 });
      g.story.hurry();
      await ctl.until(() => { g.story.hurry(); return beats().includes('corr_first_dark'); }, 20);
      mark('lights');
      await ctl.wait(1.4);
      ctl.aim(5, 1.0, { w: 1.6 });
      await ctl.wait(2.8);
      ctl.aim(-6, 0.8, { w: 1.6 });
      await ctl.wait(4.5);
      mark('end');
    },
  },

  {
    name: 'B',
    title: 'Security: the vent drops → junction: the first android wakes → pistol fight + reload',
    query: 'autostart=1&quality=ultra&god=1',
    save: 'cp_armed',
    patchSave: lightOn,
    audioSeconds: 80,
    maxSeconds: 70,
    async run({ g, ctl, mark, V }) {
      const beats = () => g.story.debugState?.beats ?? [];
      ctl.grab({ w: 4, z: 0.8 });
      // the restore fade + toast play out first (not recorded)
      g.player.teleport(V(-8.6, 0, -18.6), Math.PI * 0.62, 0.05);
      ctl.grab({ w: 4, z: 0.8 });
      await ctl.wait(3.2);
      ctl.record(true);
      mark('sec');
      ctl.walkTo([[-7.6, -18.0], [-6.9, -17.4]], { pitch: 4 });
      await ctl.wait(0.6);
      ctl.track({ x: -6, y: 2.9, z: -18.3 }, { w: 2.6, z: 0.85 });
      g.story.hurry();
      await ctl.until(() => beats().includes('#sec_vent_drop'), 12);
      mark('vent');
      ctl.track({ x: -6, y: 2.5, z: -18.4 }, { w: 6, z: 0.7 });
      await ctl.wait(3.0);
      ctl.track(null);
      mark('to-junction');
      await ctl.walkTo([[-4.6, -17.0], [-3.0, -17.0], [-1.4, -16.8]], { pitch: -2 });
      ctl.track({ x: 2.3, y: 0.9, z: -15.1 }, { w: 3.2, z: 0.8 });
      g.story.hurry();
      await ctl.until(() => beats().includes('husk_wakes'), 15);
      mark('husk');
      ctl.track(() => { const e = g.enemies.all.find((e) => e.group === 'g_junction'); return e ? { x: e.position.x, y: e.position.y + 1.45, z: e.position.z } : null; }, { w: 4, z: 0.8 });
      await ctl.until(() => ctl.foes('g_junction').some((e) => e.state === 'chase' || e.state === 'attack'), 7);
      mark('fight');
      // back off toward Security while shooting
      ctl.walkTo([[-1.6, -18.2], [-1.9, -19.0]], { lookAlong: false });
      await ctl.fight({ group: 'g_junction', reloadAfter: 4, reloadWait: 1.7, interval: 0.48, maxTime: 18, until: () => ctl.t > 9 && !g.enemies.all.some((e) => e.group === 'g_junction' && e.alive) });
      mark('dead');
      await ctl.wait(2.2);
      mark('end');
    },
  },
  {
    name: 'C',
    title: 'Airlock decon cycle → Fabrication Hall 3 reveal (light shafts, CHOIR)',
    query: 'autostart=1&quality=ultra&god=1',
    save: 'cp_fab',
    patchSave: lightOn,
    audioSeconds: 60,
    maxSeconds: 45,
    async run({ g, ctl, mark, V }) {
      const beats = () => g.story.debugState?.beats ?? [];
      g.player.teleport(V(0, 0, -21.0), 0, 0.02);
      ctl.grab({ w: 3.5, z: 0.8 });
      await ctl.wait(0.4);
      ctl.record(true);
      mark('restored');
      g.story.hurry();
      await ctl.until(() => beats().includes('#airlock_cycle'), 10);
      mark('airlock');
      ctl.aim(-35, 12, { w: 2.2 });
      await ctl.wait(1.6);
      ctl.aim(20, 4, { w: 2.0 });
      await ctl.wait(1.6);
      ctl.aim(0, 2, { w: 2.5 });
      await ctl.wait(1.8);
      mark('enter');
      await ctl.walkTo([[0, -25.0], [-0.6, -27.6], [-3.4, -30.0]], { pitch: 4 });
      mark('hall');
      ctl.track({ x: 4.5, y: 4.0, z: -37.2 }, { w: 1.5, z: 0.9 });
      await ctl.wait(3.4);
      ctl.track({ x: 0, y: 5.0, z: -49.4 }, { w: 1.3, z: 0.9 });
      await ctl.wait(3.4);
      ctl.track({ x: -4.5, y: 4.2, z: -41.8 }, { w: 1.4, z: 0.9 });
      g.story.hurry();
      await ctl.wait(7.0);
      mark('end');
    },
  },
  {
    name: 'D',
    title: 'Coolant pump room: shotgun + lock-out key pickup → skitters from the sump → shotgun pump + reload',
    query: 'autostart=1&quality=ultra&god=1',
    save: 'cp_lockout',
    patchSave: lightOn,
    audioSeconds: 60,
    maxSeconds: 45,
    // real-time setup: through the pump room, the first skitter is dealt with off-camera
    async free() {
      const g = window.__game; const V = g.player.position.constructor;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const has = (b) => (g.story.debugState?.beats ?? []).includes(b);
      g.player.teleport(new V(-13.4, 0, -38), Math.PI / 2, 0);
      for (let i = 0; i < 40 && !has('pump_enter'); i++) { g.story.hurry(); await sleep(250); }
      g.player.teleport(new V(-18.5, 0, -38), Math.PI / 2, 0);
      for (let i = 0; i < 40 && !has('pump_first_skitter'); i++) { g.story.hurry(); await sleep(250); }
      await sleep(3500);
      for (const e of [...g.enemies.all]) {
        if (!e.alive || e.state === 'dormant') continue;
        for (let k = 0; k < 6 && e.alive; k++) g.enemies.damage({ enemy: e, point: e.position.clone(), normal: new V(0, 0, 1), distance: 1, part: 'torso' }, 500, new V(0, 0, -1));
      }
      await sleep(1500);
      g.player.teleport(new V(-17.9, 0, -38.1), Math.PI / 2 + 0.12, -0.12);
    },
    async run({ g, ctl, mark }) {
      const beats = () => g.story.debugState?.beats ?? [];
      ctl.grab({ w: 3.5, z: 0.8 });
      ctl.record(true);
      mark('pump');
      await ctl.walkTo([[-19.4, -38.4]], { pitch: -14 });
      ctl.track({ x: -21.62, y: 0.1, z: -38.75 }, { w: 3.6, z: 0.85 });
      await ctl.until(() => g.player.focus?.id === 'p_shotgun', 2.5);
      await ctl.wait(0.2);
      if (g.player.focus?.id === 'p_shotgun') ctl.tap('KeyE'); else g.interactables.use(g.interactables.get('p_shotgun'));
      mark('shotgun');
      await ctl.wait(1.6);
      ctl.track({ x: -20.51, y: 0.05, z: -38.78 }, { w: 4, z: 0.85 });
      await ctl.until(() => g.player.focus?.id === 'p_lockout_key', 2.5);
      await ctl.wait(0.2);
      if (g.player.focus?.id === 'p_lockout_key') ctl.tap('KeyE'); else g.interactables.use(g.interactables.get('p_lockout_key'));
      mark('key');
      await ctl.wait(0.8);
      ctl.track(null);
      ctl.aim(-20, -2, { w: 3.0 });
      await ctl.until(() => beats().includes('key_taken'), 6);
      await ctl.until(() => ctl.foes().length > 0, 8);
      mark('skitters');
      await ctl.wait(0.25);
      await ctl.fight({ interval: 0.9, reloadAfter: 0, maxTime: 14, range: 12, tol: 3.5, w: 8, until: () => !g.enemies.all.some((e) => e.group === 'g_pump_b' && e.alive) });
      mark('cleared');
      await ctl.wait(0.4);
      ctl.tap('KeyR');
      mark('reload');
      ctl.aim(-30, -6, { w: 2.5 });
      await ctl.wait(3.2);
      mark('end');
    },
  },
  {
    name: 'E',
    title: 'Back in the hall: android + skitter → at the breaker: CHECKPOINT → power → the rack drops (wave)',
    query: 'autostart=1&quality=ultra&god=1',
    save: 'cp_key',
    patchSave: (s) => { s.player.flashlight = true; s.player.current = 'shotgun'; },
    audioSeconds: 130,
    maxSeconds: 120,
    async run({ g, ctl, mark, V }) {
      const beats = () => g.story.debugState?.beats ?? [];
      g.player.teleport(V(-3.2, 0, -39.4), Math.PI * 0.62, 0.0);
      ctl.grab({ w: 3.5, z: 0.8 });
      await ctl.wait(3.6);
      ctl.record(true);
      mark('hall');
      ctl.walkTo([[-4.6, -38.4], [-5.6, -37.8]], { pitch: 0 });
      g.story.hurry();
      await ctl.until(() => beats().includes('fab_return'), 10);
      await ctl.until(() => ctl.foes('g_fab_return').length > 0, 8);
      mark('return');
      await ctl.fight({ group: 'g_fab_return', interval: 0.95, maxTime: 14, range: 11, tol: 3.2, w: 7, until: () => !g.enemies.all.some((e) => e.group === 'g_fab_return' && e.type === 'husk' && e.alive) });
      mark('cleared');
      await ctl.wait(1.2);
      // cut: at the breaker
      g.player.teleport(V(13.1, 0, -38.3), -Math.PI / 2 + 0.25, 0.0);
      ctl.grab({ w: 3.5, z: 0.8 });
      await ctl.wait(0.5);
      ctl.record(true);
      mark('gen');
      ctl.walkTo([[14.65, -38.0]], { lookAlong: false });
      ctl.track({ x: 16.05, y: 1.3, z: -38 }, { w: 2.6, z: 0.85 });
      await ctl.until(() => { try { return JSON.parse(localStorage.getItem('coldboot.save.l1.v2')).id === 'cp_breaker'; } catch { return false; } }, 12);
      mark('checkpoint');
      await ctl.wait(2.4);
      ctl.tap('KeyE');
      mark('lever');
      await ctl.until(() => beats().includes('power_restored'), 6);
      ctl.track(null); ctl.aim(-60, 18, { w: 1.6, z: 0.85 });
      await ctl.wait(3.0);
      ctl.aim(-150, 6, { w: 1.8, z: 0.85 });
      await ctl.wait(3.0);
      // Hale's terminal boots: read it (the hall waits for this)
      await ctl.until(() => g.interactables.get('log_gen')?.enabled, 10);
      await ctl.walkTo([[13.2, -35.9]], { lookAlong: false });
      ctl.track({ x: 12.4, y: 1.42, z: -35 }, { w: 4, z: 0.85 });
      await ctl.wait(0.8);
      ctl.tap('KeyE');
      mark('terminal');
      await ctl.wait(3.0);
      ctl.tap('KeyE');
      ctl.track(null);
      await ctl.until(() => beats().includes('fab_ambush'), 30);
      mark('ambush');
      g.player.teleport(V(8.0, 0, -38.2), Math.PI / 2, 0.08);
      ctl.grab({ w: 3.5, z: 0.8 });
      await ctl.wait(0.3);
      ctl.record(true);
      mark('wave');
      ctl.aim(70, 14, { w: 2.0 });
      await ctl.until(() => ctl.foes().length > 0, 10);
      await ctl.wait(1.2);
      await ctl.fight({ interval: 0.95, maxTime: 16, range: 13, tol: 3.0, w: 6.5 });
      mark('end');
    },
  },
  {
    name: 'Z',
    title: 'end card',
    query: 'autostart=1&nostory=1&quality=ultra&noenemies=1&spawn=0,0,-23,0,0',
    audioSeconds: 20,
    maxSeconds: 12,
    async run({ g, ctl, mark }) {
      ctl.record(true);
      mark('card');
      const p = g.ui.showCard(['COLD BOOT', 'rossinek.github.io/cold-boot'], { style: 'title', skippable: false, seconds: 5.5 });
      await ctl.wait(0.05);
      for (const el of document.querySelectorAll('.cb .card .ln')) { el.style.textTransform = 'none'; }
      await p;
      mark('end');
    },
  },
];
