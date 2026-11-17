/** The single injected stylesheet for all COLD BOOT UI. Scoped under `.cb`. */

export function noiseDataUrl(size = 160): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function buildCss(noise: string): string {
  return `
.cb, .cb * { box-sizing: border-box; }
.cb {
  --fg: #dcefff; --fg-2: rgba(214,236,250,.72); --dim: rgba(170,205,225,.46); --faint: rgba(160,200,225,.16);
  --cyan: #74e4ff; --cyan-2: rgba(116,228,255,.55); --amber: #ffb24a; --red: #ff3d34; --red-2: rgba(255,61,52,.55);
  --f-thin: "Helvetica Neue", "HelveticaNeue", "Arial Narrow", "Segoe UI", Arial, sans-serif;
  --f-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --noise: url(${noise});
  position: absolute; inset: 0; overflow: hidden; color: var(--fg); font-family: var(--f-thin);
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none; cursor: default;
}
.cb .layer { position: absolute; inset: 0; pointer-events: none; }
.cb .hidden { display: none !important; }
.cb .interactive { pointer-events: auto; }
.cb .mono { font-family: var(--f-mono); }
.cb .lbl { font: 500 10px/1 var(--f-mono); letter-spacing: .32em; text-transform: uppercase; color: var(--dim); }
.cb .glow { text-shadow: 0 0 12px rgba(120,220,255,.28); }

/* ───────────── wake fx */
.cb .wake-blur { backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); z-index: 1; }
.cb .lid { position: absolute; left: -10%; right: -10%; height: 62%; background: #000; z-index: 2; pointer-events: none;
  transition-property: transform; transition-timing-function: cubic-bezier(.45,.05,.3,1); }
.cb .lid.top { top: 0; border-radius: 0 0 50% 50% / 0 0 30% 30%; box-shadow: 0 30px 60px 40px #000; transform-origin: top; }
.cb .lid.bot { bottom: 0; border-radius: 50% 50% 0 0 / 30% 30% 0 0; box-shadow: 0 -30px 60px 40px #000; transform-origin: bottom; }
.cb .black { background: #000; z-index: 6; opacity: 0; transition: opacity .6s ease; }
.cb .black.on { opacity: 1; }

/* ───────────── HUD */
.cb .hud { z-index: 3; transition: opacity .5s ease; }
.cb .hud.off { opacity: 0; }
.cb .vitals { position: absolute; left: 44px; bottom: 38px; }
.cb .vitals .row { display: flex; align-items: flex-end; gap: 14px; }
.cb .hp-num { font-weight: 200; font-size: 46px; line-height: .8; letter-spacing: .02em; min-width: 76px; font-variant-numeric: tabular-nums; }
.cb .hp-bar { display: flex; gap: 2px; padding-bottom: 3px; }
.cb .hp-seg { width: 8px; height: 7px; background: var(--fg); opacity: .82; transform: skewX(-24deg); transition: opacity .25s, background-color .25s; box-shadow: 0 0 6px rgba(150,225,255,.25); }
.cb .hp-seg.off { opacity: .1; box-shadow: none; }
.cb .vitals .head { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.cb .vitals .head .rule { width: 120px; height: 1px; background: linear-gradient(90deg, var(--faint), transparent); }
.cb .vitals.low .hp-num, .cb .vitals.low .lbl.hp { color: var(--red); }
.cb .vitals.low .hp-seg:not(.off) { background: var(--red); box-shadow: 0 0 8px var(--red-2); animation: cb-pulse 1s ease-in-out infinite; }
.cb .vitals.hit .hp-num { animation: cb-hit .35s ease-out; }
.cb .armour { margin-bottom: 9px; align-items: center; transition: opacity .3s; --arm: #8fb4d8; }
.cb .armour.off { display: none; }
.cb .armour-lbl { min-width: 76px; display: flex; flex-direction: column; gap: 3px; }
.cb .armour-lbl .lbl { color: var(--arm); opacity: .85; }
.cb .armour-num { font: 300 17px/1 var(--f-thin); letter-spacing: .04em; color: var(--arm); font-variant-numeric: tabular-nums; }
.cb .armour-bar { display: flex; gap: 2px; }
.cb .arm-seg { width: 8px; height: 6px; background: var(--arm); opacity: 1; transform: skewX(-24deg); transition: opacity .25s; box-shadow: 0 0 6px rgba(143,180,216,.35); }
.cb .arm-seg.off { opacity: 1; background: transparent; box-shadow: none; outline: 1px solid rgba(143,180,216,.16); outline-offset: -1px; }
.cb .armour.empty .armour-num { opacity: .5; }
.cb .armour.empty .arm-seg.off { outline-color: rgba(143,180,216,.4); }
.cb .armour.flash .arm-seg:not(.off) { animation: cb-arm-flash .45s ease-out; }
.cb .armour.flash .armour-num { animation: cb-arm-flash .45s ease-out; }
@keyframes cb-arm-flash { 0% { filter: brightness(2.6) drop-shadow(0 0 6px #8fb4d8); } 100% { filter: none; } }
.cb .torch { margin-top: 10px; display: flex; align-items: center; gap: 8px; font: 500 10px/1 var(--f-mono); letter-spacing: .28em; color: var(--dim); }
.cb .torch i { width: 6px; height: 6px; border: 1px solid var(--dim); border-radius: 50%; display: inline-block; }
.cb .torch.on i { background: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
.cb .torch .hint { color: var(--fg-2); margin-left: 6px; animation: cb-breathe 2.4s ease-in-out infinite; }

.cb .weapon { position: absolute; right: 44px; bottom: 38px; text-align: right; transition: opacity .35s, transform .35s; }
.cb .weapon.off { opacity: 0; transform: translateY(8px); }
.cb .weapon .head { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-bottom: 8px; }
.cb .weapon svg { height: 20px; width: auto; stroke: var(--fg-2); fill: none; stroke-width: 1.2; opacity: .9; }
.cb .ammo { display: flex; align-items: flex-end; justify-content: flex-end; gap: 10px; }
.cb .clip { font-weight: 200; font-size: 46px; line-height: .8; font-variant-numeric: tabular-nums; }
.cb .reserve { font: 400 15px/1 var(--f-mono); color: var(--dim); padding-bottom: 2px; letter-spacing: .08em; }
.cb .pips { display: flex; justify-content: flex-end; gap: 2px; margin-top: 9px; height: 8px; }
.cb .pip { width: 3px; height: 8px; background: var(--fg); opacity: .8; transition: opacity .12s; }
.cb .pip.shell { width: 7px; border-radius: 1px; background: var(--amber); }
.cb .pip.slim { width: 2px; }
.cb .weapon .head .mode { font: 500 9px/1 var(--f-mono); letter-spacing: .28em; color: var(--cyan); border: 1px solid var(--cyan-2); padding: 3px 5px 3px 7px; }
.cb .weapon .head .mode.hidden { display: none; }
.cb .pip.spent { opacity: .12; }
.cb .weapon.empty .clip { color: var(--red); }
.cb .weapon .status { height: 12px; margin-top: 8px; font: 500 10px/12px var(--f-mono); letter-spacing: .3em; color: var(--amber); }
.cb .weapon .status.blink { animation: cb-blink .7s steps(2) infinite; }

.cb .objective { position: absolute; left: 44px; top: 38px; max-width: 46vw; }
.cb .objective .head { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.cb .objective .diamond { width: 6px; height: 6px; border: 1px solid var(--cyan); transform: rotate(45deg); }
.cb .objective .rule { height: 1px; width: 160px; background: linear-gradient(90deg, var(--cyan-2), transparent); transform-origin: left; }
.cb .objective .text { font-weight: 300; font-size: 18px; letter-spacing: .04em; color: var(--fg); text-shadow: 0 1px 10px rgba(0,0,0,.9), 0 0 14px rgba(120,220,255,.18); }
.cb .objective.fresh .lbl { color: var(--amber); }
.cb .objective.fresh .diamond { border-color: var(--amber); background: var(--amber); box-shadow: 0 0 10px var(--amber); }
.cb .objective.fresh .rule { animation: cb-rule .9s cubic-bezier(.2,.8,.2,1); background: linear-gradient(90deg, var(--amber), transparent); }
.cb .objective { opacity: .5; transition: opacity 1.4s; }
.cb .objective.fresh { opacity: 1; transition: opacity .3s; }
.cb .objective.empty { opacity: 0; }

.cb .location { position: absolute; left: 0; right: 0; top: 40px; text-align: center; font: 500 11px/1 var(--f-mono); letter-spacing: .6em; color: var(--fg-2); opacity: 0; transition: opacity 1.2s ease, letter-spacing 3.5s ease; text-shadow: 0 0 10px rgba(0,0,0,.9); }
.cb .location.show { opacity: 1; letter-spacing: .72em; }
.cb .location small { display: block; margin-top: 8px; font-size: 9px; letter-spacing: .45em; color: var(--dim); }

.cb .toast { position: absolute; left: 50%; top: 88px; transform: translateX(-50%); white-space: nowrap; padding: 10px 46px;
  font: 500 11px/1 var(--f-mono); letter-spacing: .34em; text-transform: uppercase; color: var(--fg);
  background: linear-gradient(90deg, transparent, rgba(3,8,12,.72) 18%, rgba(3,8,12,.72) 82%, transparent);
  opacity: 0; transition: opacity .45s ease, transform .45s ease; }
.cb .toast::before, .cb .toast::after { content: ''; position: absolute; top: 0; bottom: 0; width: 1px; background: var(--cyan-2); }
.cb .toast::before { left: 18px; } .cb .toast::after { right: 18px; }
.cb .toast.show { opacity: 1; transform: translateX(-50%) translateY(4px); }
.cb .toast.alert { color: var(--amber); }
.cb .toast.alert::before, .cb .toast.alert::after { background: var(--amber); }

.cb .cp { position: absolute; right: 44px; top: 40px; display: flex; align-items: center; gap: 12px; opacity: 0; transition: opacity .6s ease; }
.cb .cp.show { opacity: .85; transition: opacity .25s ease; }
.cb .cp .lbl { color: var(--fg-2); letter-spacing: .34em; text-shadow: 0 0 8px rgba(0,0,0,.9); }
.cb .cp i { width: 7px; height: 7px; border: 1px solid var(--cyan); box-shadow: 0 0 8px var(--cyan-2); transform: rotate(45deg); }
.cb .cp.show i { animation: cb-cp 2.2s cubic-bezier(.3,.6,.3,1) both; }

/* foreman head pips (level 2 boss) */
.cb .boss { position: absolute; right: 44px; top: 70px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; opacity: 0; transform: translateY(-4px); transition: opacity .8s ease, transform .8s ease; }
.cb .boss.show { opacity: 1; transform: none; }
.cb .boss .lbl { font-size: 9px; letter-spacing: .36em; color: rgba(255,170,160,.55); text-shadow: 0 0 6px rgba(0,0,0,.9); }
.cb .boss .heads { display: flex; gap: 9px; }
.cb .boss .head { width: 13px; height: 15px; display: block; transition: opacity .5s ease, filter .5s ease; }
.cb .boss .head svg { width: 100%; height: 100%; display: block; overflow: visible; }
.cb .boss .head path:first-child { fill: rgba(255,90,70,.82); stroke: #ffb3a6; stroke-width: .8; }
.cb .boss .head path:last-child { stroke: #2a0604; stroke-width: 1.4; stroke-linecap: round; fill: none; }
.cb .boss .head { filter: drop-shadow(0 0 4px rgba(255,60,40,.7)) drop-shadow(0 0 1px #000); }
.cb .boss .head.dead { filter: drop-shadow(0 0 1px #000); opacity: .5; }
.cb .boss .head.dead path:first-child { fill: rgba(20,24,26,.6); stroke: rgba(200,215,225,.35); }
.cb .boss .head.dead path:last-child { stroke: rgba(200,215,225,.25); }
.cb .boss .head.die { animation: cb-head-die .7s ease-out; }
.cb .boss.hit .heads { animation: cb-boss-hit .25s ease-out; }
@keyframes cb-head-die { 0% { transform: scale(1.6); filter: drop-shadow(0 0 10px #fff) brightness(3); opacity: 1; } 100% { transform: none; } }
@keyframes cb-boss-hit { 0% { transform: translateX(-2px); } 50% { transform: translateX(2px); } 100% { transform: none; } }
.cb .xhair { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transition: opacity .15s; }
.cb .xhair.off { opacity: 0; }
.cb .xhair .dot { position: absolute; left: -1.5px; top: -1.5px; width: 3px; height: 3px; border-radius: 50%; background: rgba(235,248,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 0 6px rgba(140,225,255,.5); }
.cb .xhair .tick { position: absolute; background: rgba(235,248,255,.85); box-shadow: 0 0 0 .5px rgba(0,0,0,.4); }
.cb .xhair .t-u, .cb .xhair .t-d { width: 1px; height: 6px; left: -.5px; }
.cb .xhair .t-l, .cb .xhair .t-r { height: 1px; width: 6px; top: -.5px; }
.cb .xhair .ticks { position: absolute; left: 0; top: 0; opacity: 0; }
.cb .hitm { position: absolute; left: 0; top: 0; opacity: 0; }
.cb .hitm b { position: absolute; width: 9px; height: 1.5px; background: #fff; box-shadow: 0 0 6px rgba(255,80,60,.9); }
.cb .hitm b:nth-child(1) { left: 5px; top: -10px; transform: rotate(-45deg); }
.cb .hitm b:nth-child(2) { left: -14px; top: -10px; transform: rotate(45deg); }
.cb .hitm b:nth-child(3) { left: 5px; top: 8px; transform: rotate(45deg); }
.cb .hitm b:nth-child(4) { left: -14px; top: 8px; transform: rotate(-45deg); }

.cb .prompt { position: absolute; left: 50%; top: calc(50% + 44px); transform: translateX(-50%); display: flex; align-items: center; gap: 12px; white-space: nowrap;
  opacity: 0; transition: opacity .18s ease, transform .18s ease; }
.cb .prompt.show { opacity: 1; transform: translateX(-50%) translateY(-4px); }
.cb .key { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border: 1px solid rgba(220,240,255,.7);
  font: 600 11px/1 var(--f-mono); color: var(--fg); background: rgba(4,10,14,.55); box-shadow: 0 0 10px rgba(120,220,255,.18), inset 0 0 8px rgba(120,220,255,.08); }
.cb .prompt .ptext { font: 400 13px/1 var(--f-thin); letter-spacing: .3em; text-transform: uppercase; color: var(--fg); text-shadow: 0 1px 8px #000, 0 0 2px #000; }
.cb .prompt .bracket { width: 22px; height: 1px; background: linear-gradient(90deg, transparent, var(--cyan-2)); }
.cb .prompt .bracket.r { background: linear-gradient(90deg, var(--cyan-2), transparent); }

.cb .pickups { position: absolute; right: 44px; bottom: 170px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.cb .pk { white-space: nowrap; display: flex; gap: 10px; align-items: baseline; font: 500 11px/1 var(--f-mono); letter-spacing: .26em; color: var(--fg-2); text-shadow: 0 1px 6px #000;
  animation: cb-pk-in .35s cubic-bezier(.2,.8,.2,1) both; }
.cb .pk b { font: 300 17px/1 var(--f-thin); letter-spacing: .04em; color: var(--fg); }
.cb .pk.weapon b { color: var(--cyan); }
.cb .pk.armour b { color: #8fb4d8; }
.cb .pk.health b { color: #8dffbf; }
.cb .pk.out { animation: cb-pk-out .6s ease forwards; }

.cb .dmg { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.cb .dmg svg { position: absolute; left: -170px; top: -170px; width: 340px; height: 340px; overflow: visible; opacity: 0; filter: drop-shadow(0 0 6px rgba(255,40,30,.8)); }
.cb .dmg path { fill: none; stroke: url(#cbDmgGrad); stroke-width: 5; stroke-linecap: butt; }

/* ───────────── subtitles */
.cb .subs { position: absolute; left: 50%; bottom: 13vh; transform: translateX(-50%); width: min(980px, 86vw); text-align: center; z-index: 4;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.cb .subs .sub { width: 100%; max-height: 220px; opacity: 0; transition: opacity .4s ease, max-height .45s ease, margin .45s ease, transform .45s cubic-bezier(.2,.8,.2,1); transform-origin: 50% 100%; }
.cb .subs .sub.show { opacity: 1; }
.cb .subs .sub + .sub { margin-top: 14px; }
.cb .subs .sub.old { transform: scale(.88); }
.cb .subs .sub.old.show { opacity: .5; }
.cb .subs .sub.out { opacity: 0; max-height: 0; margin-top: 0; transition: opacity .25s ease, max-height .45s ease .05s, margin .45s ease .05s; }
.cb .subs .spk { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 9px; font: 600 10px/1 var(--f-mono); letter-spacing: .42em; color: var(--fg-2); }
.cb .subs .spk::before, .cb .subs .spk::after { content: ''; width: 26px; height: 1px; background: currentColor; opacity: .5; }
.cb .subs .line { font: 400 21px/1.42 var(--f-thin); letter-spacing: .02em; color: #f2f8ff;
  text-shadow: 0 0 2px #000, 0 2px 14px rgba(0,0,0,.95), 0 0 30px rgba(0,0,0,.8); }
.cb .subs .line .rest { color: transparent; text-shadow: none; }
.cb .subs .sub.choir .spk { color: var(--cyan); }
.cb .subs .sub.choir .line { color: #bff3ff; font-weight: 300; letter-spacing: .05em;
  text-shadow: -1px 0 rgba(255,50,70,.45), 1px 0 rgba(60,220,255,.55), 0 0 2px #000, 0 2px 14px rgba(0,0,0,.95), 0 0 22px rgba(80,210,255,.35); }
.cb .subs .sub.choir.jolt .line { transform: translateX(2px) skewX(-6deg); filter: blur(.4px); }
.cb .subs .wave { display: inline-flex; gap: 2px; align-items: center; height: 10px; }
.cb .subs .wave i { width: 2px; height: 3px; background: var(--cyan); display: block; }
.cb .subs .sub:not(.choir) .wave { display: none; }
.cb .subs .chime { display: none; width: 20px; height: 13px; }
.cb .subs .chime svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; display: block; }
.cb .subs .sub.pa .chime { display: inline-block; animation: cb-breathe 1.8s ease-in-out infinite; }
.cb .subs .spk { text-shadow: 0 0 2px #000, 0 1px 8px rgba(0,0,0,.95), 0 0 16px rgba(0,0,0,.8); }
.cb .subs .sub.pa .spk { color: #9fe6f7; letter-spacing: .36em; }
.cb .subs .sub.pa .chime svg { filter: drop-shadow(0 0 2px #000) drop-shadow(0 1px 5px rgba(0,0,0,.9)); }
.cb .subs .sub.pa .spk::before, .cb .subs .sub.pa .spk::after { display: none; }
.cb .subs .sub.pa .line { font: 300 19px/1.45 var(--f-thin); letter-spacing: .07em; color: #cfe9f2;
  text-shadow: 0 0 2px #000, 0 2px 14px rgba(0,0,0,.95), 3px 0 10px rgba(120,220,255,.22), -3px 0 10px rgba(120,220,255,.14); }
/* REVISION 4 speakers */
.cb .subs .sub.tomas .spk { color: #ffc27e; }
.cb .subs .sub.tomas .line { color: #fff4e8; }
.cb .subs .sub.unit .spk { color: #ff9a90; letter-spacing: .38em; }
.cb .subs .sub.unit .line { color: #ffe6e2; font-weight: 300; letter-spacing: .035em;
  text-shadow: 0 0 2px #000, 0 2px 14px rgba(0,0,0,.95), 0 0 18px rgba(255,80,60,.22); }
.cb .subs .sub.rec .spk { color: #a9b2b6; }
.cb .subs .sub.rec .line { color: #d9dee0; font-weight: 300; font-style: italic; }

/* intercom "live" tag (above the vitals) */
.cb .icom { position: absolute; left: 44px; bottom: 148px; z-index: 4; display: flex; align-items: center; gap: 9px; color: #ffc27e;
  opacity: 0; transform: translateY(4px); transition: opacity .35s ease, transform .35s ease; pointer-events: none; }
.cb .icom.show { opacity: 1; transform: none; }
.cb .icom .ic { width: 14px; height: 14px; display: inline-block; }
.cb .icom .ic svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; display: block; filter: drop-shadow(0 0 3px rgba(0,0,0,.9)); }
.cb .icom .live { width: 6px; height: 6px; border-radius: 50%; background: #ff5a3c; box-shadow: 0 0 8px #ff5a3c; animation: cb-breathe 1.1s ease-in-out infinite; }
.cb .icom .lbl { color: #ffc27e; letter-spacing: .3em; text-shadow: 0 0 2px #000, 0 1px 8px rgba(0,0,0,.95); }
.cb .icom .bars { display: inline-flex; align-items: center; gap: 2px; height: 12px; margin-left: 2px; }
.cb .icom .bars i { width: 2px; height: 12px; background: currentColor; opacity: .85; display: block; transform-origin: 50% 50%; transform: scaleY(.15); }

/* ───────────── note card (short fragments; never pauses, never fills the screen) */
.cb .note { position: absolute; left: 50%; bottom: 24vh; transform: translateX(-50%) translateY(10px); width: min(560px, 84vw); z-index: 5;
  opacity: 0; transition: opacity .25s ease, transform .3s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.cb .note.show { opacity: 1; transform: translateX(-50%); }
.cb .ncard { position: relative; padding: 13px 20px 15px 22px; background: linear-gradient(180deg, rgba(6,11,14,.86), rgba(3,6,8,.9));
  border: 1px solid rgba(160,200,225,.14); border-left: 2px solid var(--cyan-2); box-shadow: 0 10px 40px rgba(0,0,0,.6);
  backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
.cb .ntop { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; font: 500 9.5px/1 var(--f-mono); letter-spacing: .24em; text-transform: uppercase; color: var(--dim); }
.cb .nkind { color: var(--cyan-2); padding-right: 10px; border-right: 1px solid var(--faint); white-space: nowrap; }
.cb .nhead { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
.cb .nclose .key { height: 17px; min-width: 17px; font-size: 8.5px; padding: 0 4px; opacity: .6; }
.cb .nwave { display: none; gap: 2px; align-items: center; height: 10px; }
.cb .nwave i { width: 2px; height: 3px; background: var(--cyan); display: block; }
.cb .nbody { font: 400 17px/1.5 var(--f-thin); letter-spacing: .012em; color: #e4eef4; white-space: pre-wrap; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
.cb .nbody .rest { color: transparent; text-shadow: none; }
.cb .n-paper .ncard { border-left-color: rgba(226,205,160,.6); }
.cb .n-paper .nkind { color: rgba(226,205,160,.8); }
.cb .n-paper .nbody { font: italic 400 18px/1.48 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; color: #efe6d0; letter-spacing: .005em; }
.cb .n-terminal .nbody { font: 400 13.5px/1.6 var(--f-mono); letter-spacing: .03em; color: #bfe9d6; text-shadow: 0 0 10px rgba(110,230,170,.22); }
.cb .n-terminal .ncard { border-left-color: rgba(110,230,170,.6); }
.cb .n-terminal .nkind { color: rgba(110,230,170,.8); }
.cb .n-tag .ncard { border-left: 2px solid var(--red); background: linear-gradient(180deg, rgba(20,6,5,.88), rgba(8,3,3,.92)); }
.cb .n-tag .nkind { color: var(--red); }
.cb .n-tag .nbody { font: 600 16px/1.55 var(--f-thin); letter-spacing: .09em; color: #ffd9c9; }
.cb .n-voice .nwave { display: inline-flex; }
.cb .n-voice .nbody { font: 300 18px/1.5 var(--f-thin); font-style: italic; letter-spacing: .02em; color: #d5f1fb; }

/* ───────────── generic overlay + buttons */
.cb .ov { position: absolute; inset: 0; opacity: 0; transition: opacity .5s ease; }
.cb .ov.show { opacity: 1; }
.cb .scan::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px); mix-blend-mode: multiply; }
.cb .grain::before { content: ''; position: absolute; inset: -50%; pointer-events: none; background-image: var(--noise); opacity: .04;
  animation: cb-grain .9s steps(6) infinite; mix-blend-mode: screen; }
.cb .btn { position: relative; display: flex; align-items: center; gap: 18px; padding: 11px 0 11px 22px; cursor: pointer; background: none; border: 0; color: var(--fg-2);
  font: 400 14px/1 var(--f-thin); letter-spacing: .42em; text-transform: uppercase; text-align: left; transition: color .2s, transform .25s cubic-bezier(.2,.8,.2,1); }
.cb .btn .n { font: 500 9px/1 var(--f-mono); letter-spacing: .2em; color: var(--dim); width: 18px; }
.cb .btn::before { content: ''; position: absolute; left: 0; top: 50%; width: 2px; height: 0; background: var(--cyan); box-shadow: 0 0 10px var(--cyan); transform: translateY(-50%); transition: height .25s cubic-bezier(.2,.8,.2,1); }
.cb .btn::after { content: ''; position: absolute; left: 22px; right: -40px; bottom: 4px; height: 1px; background: linear-gradient(90deg, var(--cyan-2), transparent); transform: scaleX(0); transform-origin: left; transition: transform .35s cubic-bezier(.2,.8,.2,1); }
.cb .btn:hover, .cb .btn.sel { color: var(--fg); transform: translateX(6px); }
.cb .btn:hover::before, .cb .btn.sel::before { height: 16px; }
.cb .btn:hover::after, .cb .btn.sel::after { transform: scaleX(1); }
.cb .btn.primary { color: var(--fg); font-size: 16px; }
.cb .btn.danger:hover { color: var(--red); }
.cb .btn .where { margin-left: 4px; font: 500 9px/1 var(--f-mono); letter-spacing: .28em; text-transform: uppercase; color: var(--dim); }
.cb .btn.danger::before { background: var(--red); box-shadow: 0 0 10px var(--red); }

/* settings */
.cb .panel { position: relative; padding: 26px 30px; background: linear-gradient(180deg, rgba(6,14,20,.78), rgba(3,8,12,.7)); border: 1px solid var(--faint); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.cb .panel::before, .cb .panel::after { content: ''; position: absolute; width: 10px; height: 10px; border: 1px solid var(--cyan-2); }
.cb .panel::before { left: -1px; top: -1px; border-right: 0; border-bottom: 0; }
.cb .panel::after { right: -1px; bottom: -1px; border-left: 0; border-top: 0; }
.cb .panel h3 { margin: 0 0 22px; font: 500 10px/1 var(--f-mono); letter-spacing: .4em; color: var(--cyan); text-transform: uppercase; }
.cb .setting { margin-bottom: 22px; }
.cb .setting:last-child { margin-bottom: 0; }
.cb .setting .lbl { display: flex; justify-content: space-between; margin-bottom: 11px; }
.cb .setting .lbl span:last-child { color: var(--fg); }
.cb .seg { display: flex; gap: 0; border: 1px solid var(--faint); }
.cb .seg button { flex: 1; padding: 9px 14px; background: none; border: 0; border-right: 1px solid var(--faint); color: var(--dim); cursor: pointer;
  font: 500 10px/1 var(--f-mono); letter-spacing: .26em; text-transform: uppercase; transition: color .2s, background .2s; }
.cb .seg button:last-child { border-right: 0; }
.cb .seg button:hover { color: var(--fg); background: rgba(120,220,255,.05); }
.cb .seg button.on { color: #031016; background: var(--fg); }
.cb input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; background: transparent; cursor: pointer; margin: 0; }
.cb input[type=range]::-webkit-slider-runnable-track { height: 1px; background: linear-gradient(90deg, var(--cyan) var(--p,50%), var(--faint) var(--p,50%)); }
.cb input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 15px; margin-top: -7px; background: var(--fg); border: 0; box-shadow: 0 0 10px rgba(140,225,255,.6); }
.cb input[type=range]::-moz-range-track { height: 1px; background: var(--faint); }
.cb input[type=range]::-moz-range-progress { height: 1px; background: var(--cyan); }
.cb input[type=range]::-moz-range-thumb { width: 9px; height: 15px; border: 0; border-radius: 0; background: var(--fg); }
.cb .controls { display: grid; grid-template-columns: auto 1fr; gap: 11px 22px; align-items: center; }
.cb .controls .k { display: flex; gap: 5px; justify-content: flex-end; }
.cb .controls .key { height: 21px; min-width: 21px; font-size: 10px; }
.cb .controls .d { font: 400 12px/1 var(--f-thin); letter-spacing: .26em; text-transform: uppercase; color: var(--fg-2); }

/* ───────────── main menu */
.cb .menu { z-index: 8; background:
  radial-gradient(120% 90% at 70% 45%, transparent 35%, rgba(0,0,0,.6) 100%),
  linear-gradient(90deg, rgba(1,4,7,.9) 0%, rgba(1,4,7,.66) 32%, rgba(1,4,7,.05) 66%, rgba(1,4,7,.2) 100%); }
.cb .menu .col { position: absolute; left: 8vw; top: 50%; transform: translateY(-54%); width: min(720px, 60vw); }
.cb .menu .eyebrow { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
.cb .menu .eyebrow .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--red); box-shadow: 0 0 8px var(--red); animation: cb-blink 1.6s steps(2) infinite; }
.cb .title { position: relative; margin: 0; font-weight: 100; font-size: clamp(54px, 8.2vw, 128px); line-height: .9; letter-spacing: .34em; white-space: nowrap; color: #eaf6ff;
  text-shadow: 0 0 22px rgba(120,220,255,.35), 0 0 2px rgba(200,240,255,.6); animation: cb-flicker 7s linear infinite; margin-right: -.34em; }
.cb .title span { display: inline-block; transition: opacity .08s; }
.cb .title span.g { color: var(--cyan); text-shadow: -3px 0 rgba(255,40,60,.7), 3px 0 rgba(60,220,255,.8); transform: translateY(-2px) skewX(-8deg); }
.cb .title span.x { opacity: .15; }
.cb .title .ghost { position: absolute; inset: 0; color: rgba(116,228,255,.5); pointer-events: none; clip-path: inset(0 0 100% 0); text-shadow: none; animation: none; }
.cb .title.tear .ghost { animation: cb-tear .26s steps(3) 1; }
.cb .subtitle { margin-top: 26px; font: 300 13px/1.6 var(--f-thin); letter-spacing: .5em; color: var(--fg-2); text-transform: uppercase; }
.cb .menu .rule2 { position: relative; margin: 30px 0 34px; height: 1px; width: 380px; background: var(--faint); overflow: hidden; }
.cb .menu .rule2::after { content: ''; position: absolute; top: 0; height: 1px; width: 70px; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); animation: cb-scan 4.5s cubic-bezier(.6,0,.4,1) infinite; }
.cb .menu .items { display: flex; flex-direction: column; gap: 2px; }
.cb .menu .lvlline { display: flex; align-items: center; gap: 10px; padding: 0 0 6px 62px; font-size: 9px; letter-spacing: .34em; color: var(--amber); }
.cb .menu .lvlline i { width: 5px; height: 5px; background: var(--amber); box-shadow: 0 0 8px var(--amber); transform: rotate(45deg); display: inline-block; }
.cb .menu .side { position: absolute; right: 7vw; top: 50%; transform: translateY(-50%) translateX(12px); width: min(400px, 32vw); opacity: 0; transition: opacity .35s, transform .35s cubic-bezier(.2,.8,.2,1); }
.cb .menu .side.show { opacity: 1; transform: translateY(-50%); }
.cb .foot { position: absolute; left: 8vw; right: 7vw; bottom: 36px; display: flex; justify-content: space-between; align-items: flex-end; gap: 40px; }
.cb .foot .warn { font: 500 10px/1.7 var(--f-mono); letter-spacing: .22em; color: var(--dim); text-transform: uppercase; max-width: 560px; }
.cb .foot .warn b { color: var(--amber); font-weight: 500; }
.cb .foot .sys { font: 500 10px/1.7 var(--f-mono); letter-spacing: .22em; color: var(--dim); text-align: right; white-space: nowrap; }
.cb .foot .sys em { font-style: normal; color: var(--red); }
.cb .menu.leaving { transition: opacity .9s ease; opacity: 0 !important; }

/* ───────────── pause */
.cb .pause { z-index: 9; background: radial-gradient(130% 100% at 30% 50%, rgba(2,6,9,.55), rgba(0,0,0,.85)); backdrop-filter: blur(7px) saturate(.6); -webkit-backdrop-filter: blur(7px) saturate(.6); }
.cb .pause .col { position: absolute; left: 8vw; top: 50%; transform: translateY(-50%); }
.cb .pause h2 { margin: 0 0 14px; font-weight: 100; font-size: 64px; letter-spacing: .4em; line-height: 1; }
.cb .pause .meta { margin-bottom: 8px; }
.cb .pause .obj { margin: 18px 0 34px; font: 300 15px/1.5 var(--f-thin); letter-spacing: .06em; color: var(--fg-2); max-width: 460px; }
.cb .pause .obj b { display: block; margin-bottom: 7px; }
.cb .pause .side { position: absolute; right: 7vw; top: 50%; transform: translateY(-50%); width: min(400px, 32vw); }
.cb .pause .hint { position: absolute; left: 8vw; bottom: 36px; }

/* ───────────── log reader */
.cb .logov { z-index: 7; display: grid; place-items: center; background: radial-gradient(ellipse at center, rgba(0,0,0,.35), rgba(0,0,0,.82)); backdrop-filter: blur(3px) saturate(.7); -webkit-backdrop-filter: blur(3px) saturate(.7); }
.cb .log { position: relative; width: min(760px, 88vw); max-height: 76vh; display: flex; flex-direction: column; padding: 30px 36px 22px;
  background: linear-gradient(180deg, rgba(8,18,24,.94), rgba(3,9,13,.95)); border: 1px solid rgba(140,220,255,.16);
  box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 30px 80px rgba(0,0,0,.7), inset 0 0 80px rgba(80,180,220,.05);
  transform: translateY(10px) scale(.985); transition: transform .45s cubic-bezier(.2,.8,.2,1); overflow: hidden; }
.cb .logov.show .log { transform: none; }
.cb .log::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--cyan), transparent); opacity: .7; }
.cb .log .scanbar { position: absolute; left: 0; right: 0; height: 80px; top: -80px; background: linear-gradient(180deg, transparent, rgba(116,228,255,.06), transparent); animation: cb-scanbar 5s linear infinite; pointer-events: none; }
.cb .log .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.cb .log .top .rec { display: flex; gap: 10px; align-items: center; }
.cb .log .top .rec i { width: 6px; height: 6px; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); display: inline-block; animation: cb-blink 1.2s steps(2) infinite; }
.cb .log h1 { margin: 0 0 18px; font: 200 25px/1.2 var(--f-thin); letter-spacing: .14em; color: var(--fg); text-transform: uppercase; }
.cb .log .metab { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; padding: 13px 0; margin-bottom: 18px; border-top: 1px solid var(--faint); border-bottom: 1px solid var(--faint);
  font: 400 11px/1.4 var(--f-mono); letter-spacing: .06em; }
.cb .log .metab dt { color: var(--dim); letter-spacing: .26em; }
.cb .log .metab dd { margin: 0; color: var(--fg-2); }
.cb .log .body { flex: 1; overflow-y: auto; padding-right: 14px; font: 300 16px/1.68 var(--f-thin); letter-spacing: .015em; color: #d9eaf5; white-space: pre-wrap; scrollbar-width: thin; scrollbar-color: rgba(140,220,255,.35) transparent; }
.cb .log .body.mono { font: 400 13px/1.62 var(--f-mono); letter-spacing: .02em; color: #bfe9d6; }
.cb .log .body::-webkit-scrollbar { width: 3px; } .cb .log .body::-webkit-scrollbar-thumb { background: rgba(140,220,255,.35); }
.cb .log .body .rest { color: transparent; }
.cb .log .body .caret { display: inline-block; width: .55em; height: 1.05em; margin-bottom: -.18em; background: var(--cyan); opacity: .8; animation: cb-blink .8s steps(2) infinite; }
.cb .log .bot { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--faint); }
.cb .log .bot .keys { display: flex; gap: 22px; align-items: center; }
.cb .log .bot .keys span { display: flex; gap: 9px; align-items: center; }
.cb .log .bot .key { height: 20px; min-width: 20px; font-size: 9px; }

/* ───────────── cards */
.cb .card { z-index: 10; background: #000; display: grid; place-items: center; }
.cb .card .stage { position: relative; text-align: center; }
.cb .card .ln { font: 400 13px/1 var(--f-mono); letter-spacing: .55em; color: var(--fg-2); text-transform: uppercase; opacity: 0; transition: opacity 1s ease, letter-spacing 4s ease; margin-right: -.55em; }
.cb .card .ln.show { opacity: 1; letter-spacing: .62em; }
.cb .card .ln.last { color: var(--fg); }
.cb .card .ln.last.show { text-shadow: 0 0 16px rgba(120,220,255,.35); }
.cb .card.card-title .big { font: 100 clamp(44px, 6vw, 88px)/1 var(--f-thin); letter-spacing: .9em; margin-right: -.5em; color: #eef8ff; opacity: 0;
  transition: opacity 1.8s ease, letter-spacing 5s cubic-bezier(.2,.8,.2,1); text-shadow: 0 0 24px rgba(120,220,255,.3); }
.cb .card.card-title .big.show { opacity: 1; letter-spacing: .5em; }
.cb .card.card-title .rule { width: 0; height: 1px; margin: 28px auto; background: linear-gradient(90deg, transparent, var(--cyan), transparent); transition: width 2.6s cubic-bezier(.2,.8,.2,1) .4s; }
.cb .card.card-title .rule.show { width: 340px; }
.cb .card .stage { max-width: min(1000px, 88vw); }
.cb .card .ln.multi { white-space: pre-line; line-height: 2.1; }
.cb .card .ln.long { font-size: 12px; line-height: 2; letter-spacing: .3em; margin-right: -.3em; }
.cb .card .ln.long.show { letter-spacing: .34em; }
.cb .card .ln.statl { font-size: 11px; color: var(--dim); letter-spacing: .4em; }
.cb .card .ln.statl.show { letter-spacing: .44em; }
.cb .card .ln.gap { height: 6px; }
.cb .card .ln.tbcl { margin-top: 18px; font: 500 12px/1 var(--f-mono); color: var(--cyan); letter-spacing: .7em; margin-right: -.7em; }
.cb .card .ln.tbcl.show { letter-spacing: .78em; text-shadow: 0 0 16px rgba(120,220,255,.35); }
.cb .card.card-title .ln { margin-top: 4px; }
.cb .card .skip { position: absolute; right: 44px; bottom: 36px; opacity: 0; transition: opacity 1s; }
.cb .card .skip.show { opacity: .7; }
.cb .card.fadeout { transition: opacity 1.2s ease; opacity: 0 !important; }

/* ───────────── death */
.cb .death { z-index: 11; display: grid; place-items: center; text-align: center;
  background: radial-gradient(ellipse at center, rgba(60,0,0,.45) 0%, rgba(10,0,0,.85) 55%, #000 100%); }
.cb .death h2 { margin: 0; font: 100 clamp(48px, 7vw, 104px)/1 var(--f-thin); letter-spacing: .42em; margin-right: -.42em; color: #ffe9e6;
  text-shadow: -3px 0 rgba(255,40,40,.65), 3px 0 rgba(60,220,255,.35), 0 0 30px rgba(255,40,30,.4); animation: cb-flicker 4s linear infinite; }
.cb .death .meta { margin-top: 22px; color: rgba(255,150,140,.6); }
.cb .death .taunt { margin: 46px auto 0; max-width: 720px; min-height: 64px; }
.cb .death .taunt .spk { font: 600 10px/1 var(--f-mono); letter-spacing: .42em; color: var(--cyan); margin-bottom: 12px; }
.cb .death .taunt .line { font: 300 21px/1.4 var(--f-thin); letter-spacing: .05em; color: #bff3ff;
  text-shadow: -1px 0 rgba(255,50,70,.45), 1px 0 rgba(60,220,255,.55), 0 0 22px rgba(80,210,255,.35); }
.cb .death .taunt .line .rest { color: transparent; text-shadow: none; }
.cb .death .acts { display: flex; justify-content: center; gap: 40px; margin-top: 54px; opacity: 0; transition: opacity 1s ease; }
.cb .death .acts.show { opacity: 1; }

/* ───────────── ending */
.cb .ending { z-index: 11; display: grid; place-items: center; text-align: center; background: #000; }
.cb .ending .title { font-size: clamp(48px, 6.6vw, 104px); }
.cb .ending .endstatus { margin-top: 30px; color: var(--fg-2); letter-spacing: .34em; }
.cb .ending .tbc { margin-top: 26px; font: 500 12px/1 var(--f-mono); letter-spacing: .7em; color: var(--cyan); margin-right: -.7em; }
.cb .ending .stats { display: flex; justify-content: center; gap: 0; width: fit-content; margin: 64px auto 0; border-top: 1px solid var(--faint); border-bottom: 1px solid var(--faint); }
.cb .ending .stat { padding: 20px 38px; border-right: 1px solid var(--faint); text-align: left; }
.cb .ending .stat:last-child { border-right: 0; }
.cb .ending .stat b { display: block; margin-top: 12px; font: 200 34px/1 var(--f-thin); letter-spacing: .04em; color: var(--fg); font-variant-numeric: tabular-nums; }
.cb .ending .stage > * { opacity: 0; transform: translateY(6px); transition: opacity 1.6s ease, transform 1.6s ease; }
.cb .ending .stage > .show { opacity: 1; transform: none; }
.cb .ending .acts { display: flex; justify-content: center; margin-top: 44px; }
.cb .ending .credit { margin-top: 40px; }

/* ───────────── resume gate */
.cb .gate { z-index: 11; display: grid; place-items: center; text-align: center; background: #000; cursor: pointer; }
.cb .gate h2 { margin: 0 0 22px; font: 100 44px/1 var(--f-thin); letter-spacing: .5em; margin-right: -.5em; }
.cb .gate .lbl { animation: cb-breathe 2.4s ease-in-out infinite; }

@keyframes cb-cp { 0% { transform: rotate(45deg) scale(.4); background: var(--cyan); } 45% { transform: rotate(225deg) scale(1); background: var(--cyan); } 70% { transform: rotate(405deg) scale(1); background: transparent; } 100% { transform: rotate(405deg) scale(1); background: transparent; } }
@keyframes cb-pulse { 0%,100% { opacity: .95; } 50% { opacity: .35; } }
@keyframes cb-hit { 0% { transform: translateX(-3px); color: var(--red); } 100% { transform: none; } }
@keyframes cb-breathe { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@keyframes cb-blink { 0% { opacity: 1; } 100% { opacity: .15; } }
@keyframes cb-rule { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes cb-pk-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@keyframes cb-pk-out { to { opacity: 0; transform: translateY(-6px); } }
@keyframes cb-grain { 0% { transform: translate(0,0); } 20% { transform: translate(-6%,4%); } 40% { transform: translate(5%,-7%); } 60% { transform: translate(-3%,8%); } 80% { transform: translate(7%,2%); } 100% { transform: translate(0,0); } }
@keyframes cb-scan { 0% { left: -80px; } 60%,100% { left: 100%; } }
@keyframes cb-scanbar { 0% { top: -80px; } 100% { top: 110%; } }
@keyframes cb-flicker { 0%, 7.9%, 8.6%, 41%, 41.6%, 73%, 100% { opacity: 1; } 8% { opacity: .55; } 8.3% { opacity: .9; } 41.3% { opacity: .7; } 73.4% { opacity: .82; } }
@keyframes cb-tear { 0% { clip-path: inset(18% 0 62% 0); transform: translateX(-10px); } 50% { clip-path: inset(56% 0 22% 0); transform: translateX(14px); } 100% { clip-path: inset(80% 0 6% 0); transform: translateX(-5px); } }
`;
}
