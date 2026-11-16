/**
 * Animated monitor materials. Each screen draws into its own small canvas (CanvasTexture as emissiveMap)
 * at a throttled rate, only while it was actually rendered recently (material.onBeforeRender), with a
 * global cap on redraws per frame. A shared overlay adds pixel grid, scanlines, vignette and glass glare.
 */
import * as THREE from 'three';
import type { LevelInfo, ScreenKind } from '../core/types';

const MONO = 'ui-monospace, Menlo, "SF Mono", Consolas, monospace';
const SANS = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

interface Screen {
  mat: THREE.MeshStandardMaterial;
  kind: ScreenKind;
  text: string | undefined;
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  W: number; H: number;
  aspect: number;
  t: number;
  since: number;
  lastSeen: number;
  drawn: boolean;
  seed: number;
  rand: () => number;
  lines: string[];
  lineTimer: number;
  scroll: number;
  noise: ImageData | null;
  noiseCv: HTMLCanvasElement | null;
}

const INTENSITY: Record<ScreenKind, number> = {
  terminal_idle: 2.6, terminal_alert: 3.2, static: 1.8, choir: 3.5, camera_feed: 2.0, vitals: 2.6, door_locked: 3.5, door_open: 3.0, door_cycling: 3.2,
  choice_stop: 2.2, choice_command: 2.2, palm: 3.0,
  // stage 3a §8.5: placeholders until task P1 draws these kinds (blank panels until then)
  pressure: 3.0, habitat_status: 2.6, badge: 3.0, feed: 2.0, cctv: 2.0,
};
const RATE: Record<ScreenKind, number> = {
  terminal_idle: 10, terminal_alert: 10, static: 15, choir: 15, camera_feed: 12, vitals: 12, door_locked: 5, door_open: 4, door_cycling: 8,
  choice_stop: 6, choice_command: 6, palm: 24,
  pressure: 4, habitat_status: 4, badge: 8, feed: 12, cctv: 12,
};
/**
 * Canvas size of a kind on a quad of `aspect`. The option cards of the core are 12 m wide wall displays that must
 * be read from across the room: on a wide quad they get a 2048 px canvas (everything else 512 / 256).
 */
function sizeFor(kind: ScreenKind, aspect: number): [number, number] {
  const base = kind.startsWith('door') ? 256 : kind.startsWith('choice') && aspect >= 2.4 ? 2048 : 512;
  return aspect >= 1 ? [base, Math.max(16, Math.round(base / aspect))] : [Math.round(base * aspect), base];
}
const MAX_DRAWS_PER_UPDATE = 4;

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

const WORDS = {
  sys: ['CHOIR', 'HALCYON', 'ERIDU', 'FAB-3', 'SUBLVL-3', 'NODE', 'RELAY', 'MED-3A', 'SEC-3', 'GEN-3', 'LIFT-F2', 'ARM-07', 'CONV-2'],
  verb: ['SYNC', 'POLL', 'ROUTE', 'RETASK', 'VERIFY', 'ALLOC', 'HANDSHAKE', 'PURGE', 'QUEUE', 'REINDEX', 'LISTEN'],
  stat: ['OK', 'OK', 'OK', 'NOMINAL', 'DEFERRED', 'NO ACK', 'TIMEOUT', 'RETRY', 'WE HEAR', 'ACCEPTED', 'OVERRIDE'],
};
function logLine(r: () => number): string {
  const p = (a: string[]) => a[Math.floor(r() * a.length)];
  const hex = () => Math.floor(r() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const k = r();
  if (k < 0.08) return '> CHOIR: ' + p(['ALL STAFF ARE BEING RE-TASKED', 'WE ARE LISTENING', 'PLEASE REMAIN WHERE YOU ARE', 'SURFACE LINK NOT REQUIRED', 'THANK YOU FOR YOUR PATIENCE']);
  if (k < 0.2) return `[${hex()}] ${p(WORDS.sys)}.${p(WORDS.sys)} :: ${p(WORDS.stat)}`;
  if (k < 0.35) return `  PWR BUS ${Math.floor(r() * 9)}  ${(r() * 480).toFixed(1)}V  ${(r() * 40).toFixed(2)}A  ${p(WORDS.stat)}`;
  if (k < 0.45) return `  SURFACE UPLINK ........ ${p(['NO CARRIER', 'NO CARRIER', 'REFUSED', 'NOT REQUIRED'])}`;
  return `${hex()}:${hex()}  ${p(WORDS.verb)} ${p(WORDS.sys)}-${Math.floor(r() * 99)} ${'.'.repeat(2 + Math.floor(r() * 8))} ${p(WORDS.stat)}`;
}

const overlays = new Map<string, HTMLCanvasElement>();
function overlay(W: number, H: number): HTMLCanvasElement {
  const key = `${W}x${H}`;
  let o = overlays.get(key);
  if (o) return o;
  o = document.createElement('canvas'); o.width = W; o.height = H;
  const g = o.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  // RGB sub-pixel columns + row gaps (multiply)
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const row = y % 3 === 2 ? 0.55 : 1.0;
    const c = x % 3;
    d[i] = 255 * row * (c === 0 ? 1 : 0.72);
    d[i + 1] = 255 * row * (c === 1 ? 1 : 0.72);
    d[i + 2] = 255 * row * (c === 2 ? 1 : 0.72);
  }
  g.putImageData(img, 0, 0);
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  overlays.set(key, o);
  return o;
}

function glare(g: CanvasRenderingContext2D, W: number, H: number) {
  g.globalCompositeOperation = 'lighter';
  const lg = g.createLinearGradient(0, 0, W * 0.6, H);
  lg.addColorStop(0, 'rgba(255,255,255,0.05)'); lg.addColorStop(0.35, 'rgba(255,255,255,0.015)'); lg.addColorStop(0.36, 'rgba(255,255,255,0)');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}

export class ScreenManager {
  private screens: Screen[] = [];
  private byMat = new WeakMap<THREE.Material, Screen>();
  private frame = 0;
  private cursor = 0;
  private seedCounter = 1;

  /** Level-specific chrome (REVISION 4; §8.1 from `LEVELS`): header / camera labels, terminal_idle shows its `text`. */
  private header: string;
  private camLabel: string;
  private idleText: boolean;
  constructor(private track: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial, level: Pick<LevelInfo, 'screenHeader' | 'camLabel' | 'idleText'>) {
    this.header = level.screenHeader;
    this.camLabel = level.camLabel;
    this.idleText = level.idleText;
  }

  create(kind: ScreenKind, opts?: { text?: string; aspect?: number }): THREE.MeshStandardMaterial {
    const aspect = opts?.aspect ?? (kind.startsWith('door') ? 2 : 1.6);
    const [W, H] = sizeFor(kind, aspect);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: false })!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      name: `screen_${kind}`,
      color: 0x040505, roughness: 0.12, metalness: 0,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: INTENSITY[kind],
      // a screen always sits in a bezel / on a panel: it wins the depth test against it (REVISION 5.1)
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    const seed = this.seedCounter++ * 7919;
    const s: Screen = {
      mat, kind, text: opts?.text, cv, g, tex, W, H, aspect, t: Math.random() * 10, since: 1, lastSeen: -100, drawn: false,
      seed, rand: rng(seed), lines: [], lineTimer: 0, scroll: 0, noise: null, noiseCv: null,
    };
    mat.onBeforeRender = () => { s.lastSeen = this.frame; };
    mat.userData.screenKind = kind; mat.userData.screenText = opts?.text ?? ''; // what it shows (tests, debugging)
    this.prime(s);
    this.draw(s);
    this.screens.push(s);
    this.byMat.set(mat, s);
    return this.track(mat);
  }

  set(mat: THREE.MeshStandardMaterial, kind: ScreenKind, opts?: { text?: string }) {
    const s = this.byMat.get(mat);
    if (!s) { console.warn('[materials] setScreen: not a screen material'); return; }
    // the same card with another number (the unit count changed): redraw, keep its animation clock
    const same = s.kind === kind && kind.startsWith('choice');
    s.kind = kind; s.text = opts?.text;
    mat.userData.screenKind = kind; mat.userData.screenText = opts?.text ?? '';
    if (!same) { s.t = 0; mat.emissiveIntensity = INTENSITY[kind]; }
    // a kind with another canvas size (waveform ↔ option card on the core's side walls): re-allocate
    const [W, H] = sizeFor(kind, s.aspect);
    if (W !== s.W || H !== s.H) {
      s.cv.width = W; s.cv.height = H; s.W = W; s.H = H;
      s.noise = null; s.noiseCv = null;
      // mip-mapped when wall-sized (read at a slant from the door); the GL texture is re-created on the next upload
      const big = W > 1024;
      s.tex.generateMipmaps = big; s.tex.minFilter = big ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; s.tex.anisotropy = big ? 8 : 4;
      s.tex.dispose();
    }
    this.prime(s);
    this.draw(s);
  }

  private prime(s: Screen) {
    s.lines.length = 0;
    if (s.kind === 'terminal_idle') for (let i = 0; i < 24; i++) s.lines.push(logLine(s.rand));
    if (s.kind === 'static' && !s.noise) {
      s.noiseCv = document.createElement('canvas');
      s.noiseCv.width = Math.ceil(s.W / 2); s.noiseCv.height = Math.ceil(s.H / 2);
      s.noise = s.noiseCv.getContext('2d')!.createImageData(s.noiseCv.width, s.noiseCv.height);
    }
  }

  update(dt: number) {
    this.frame++;
    const n = this.screens.length;
    if (!n) return;
    for (let i = 0; i < n; i++) { const s = this.screens[i]; s.t += dt; s.since += dt; }
    let draws = 0;
    for (let k = 0; k < n && draws < MAX_DRAWS_PER_UPDATE; k++) {
      const s = this.screens[(this.cursor + k) % n];
      if (this.frame - s.lastSeen > 3 && s.drawn) continue;
      if (s.since < 1 / RATE[s.kind]) continue;
      this.draw(s);
      draws++;
    }
    this.cursor = (this.cursor + 1) % n;
  }

  private draw(s: Screen) {
    const { g, W, H } = s;
    s.since = 0; s.drawn = true;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    switch (s.kind) {
      case 'terminal_idle': this.terminal(s); break;
      case 'terminal_alert': this.alert(s); break;
      case 'static': this.staticNoise(s); break;
      case 'choir': this.choir(s); break;
      case 'camera_feed': this.camera(s); break;
      case 'vitals': this.vitals(s); break;
      case 'door_locked': this.door(s, false); break;
      case 'door_open': this.door(s, true); break;
      case 'door_cycling': this.door(s, 'cycling'); break;
      case 'choice_stop': this.choice(s, true); break;
      case 'choice_command': this.choice(s, false); break;
      case 'palm': this.palm(s); break;
    }
    g.globalAlpha = 1;
    // (the wall-sized cards are seen from far and at a slant: a sub-pixel grid would only alias into moiré)
    if (W <= 1024) {
      g.globalCompositeOperation = 'multiply';
      g.drawImage(overlay(W, H), 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    glare(g, W, H);
    s.tex.needsUpdate = true;
  }

  // ───────────────────────────── kinds
  private terminal(s: Screen) {
    const { g, W, H } = s;
    const amber = (s.seed & 1) === 0;
    const fg = amber ? '#ffb347' : '#7dff9a';
    const dim = amber ? 'rgba(255,179,71,0.45)' : 'rgba(125,255,154,0.45)';
    g.fillStyle = amber ? '#0d0702' : '#020b05'; g.fillRect(0, 0, W, H);
    const fs = Math.max(9, Math.round(H / 22));
    g.font = `${fs}px ${MONO}`; g.textBaseline = 'top'; g.textAlign = 'left';
    // header
    g.fillStyle = fg; g.fillRect(0, 0, W, fs * 1.5);
    g.fillStyle = amber ? '#0d0702' : '#020b05';
    g.fillText(this.header, fs * 0.5, fs * 0.25);
    // advance log
    const step = 0.45;
    while (s.t - s.lineTimer > step) { s.lineTimer += step; s.lines.push(logLine(s.rand)); if (s.lines.length > 40) s.lines.shift(); }
    const frac = (s.t - s.lineTimer) / step;
    // level 2: a pinned message block (the screen's `text`) above the scrolling log
    let top = fs * 1.8;
    if (this.idleText && s.text) {
      const msg = s.text.split('\n');
      const big = Math.max(fs, Math.min(Math.round(H / (msg.length * 1.6 + 4)), Math.round(fs * 2.4)));
      g.save();
      g.shadowColor = fg; g.shadowBlur = big * 0.5;
      g.fillStyle = '#f2f6ee';
      msg.forEach((ln, i) => {
        let sz = big; g.font = `700 ${sz}px ${MONO}`;
        while (g.measureText(ln).width > W - fs && sz > 8) { sz -= 1; g.font = `700 ${sz}px ${MONO}`; }
        g.fillText(ln, fs * 0.5, top + fs * 0.4 + i * big * 1.25);
      });
      g.restore();
      top += fs * 0.8 + msg.length * big * 1.25;
      g.fillStyle = dim; g.fillRect(fs * 0.5, top - fs * 0.3, W - fs, 1);
      g.font = `${fs}px ${MONO}`;
    }
    const rows = Math.floor((H - top - fs * 1.7) / (fs * 1.18));
    const start = Math.max(0, s.lines.length - rows);
    g.save();
    g.beginPath(); g.rect(0, top, W, H - top - fs * 1.8); g.clip();
    g.shadowColor = fg; g.shadowBlur = fs * 0.6;
    for (let i = start; i < s.lines.length; i++) {
      const y = top + fs * 0.2 + (i - start) * fs * 1.18 - frac * fs * 1.18 * 0.0;
      const ln = s.lines[i];
      g.fillStyle = ln.startsWith('> CHOIR') ? '#e8f4ff' : (i === s.lines.length - 1 ? fg : dim);
      g.fillText(ln, fs * 0.5, y);
    }
    g.restore();
    // footer + cursor
    g.fillStyle = dim; g.fillRect(0, H - fs * 1.6, W, 1);
    g.fillStyle = fg;
    const blink = Math.floor(s.t * 2) % 2 === 0;
    g.fillText(`OPERATOR: ---   LINK: NO CARRIER   ${blink ? '█' : ' '}`, fs * 0.5, H - fs * 1.35);
  }

  private alert(s: Screen) {
    const { g, W, H } = s;
    const on = Math.floor(s.t * 2.2) % 2 === 0;
    g.fillStyle = on ? '#3a0302' : '#120000'; g.fillRect(0, 0, W, H);
    // hazard border
    const b = Math.max(8, H * 0.07);
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.rect(b, b, W - 2 * b, H - 2 * b); g.clip('evenodd');
    g.fillStyle = on ? '#ff2a1a' : '#5a0805'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#100000';
    for (let x = -H; x < W + H; x += b * 2) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + b, H); g.lineTo(x + b + H, 0); g.lineTo(x + H, 0); g.closePath(); g.fill(); }
    g.restore();
    const msg = (s.text ?? 'WARNING').toUpperCase();
    const lines = msg.split('\n');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = on ? '#ffd8d0' : '#ff3a28';
    g.shadowColor = '#ff2010'; g.shadowBlur = H * 0.06;
    const fs = Math.min(H * 0.3 / lines.length, H * 0.26);
    lines.forEach((ln, i) => {
      let sz = fs; g.font = `900 ${sz}px ${SANS}`;
      while (g.measureText(ln).width > W - b * 4 && sz > 8) { sz -= 2; g.font = `900 ${sz}px ${SANS}`; }
      g.fillText(ln, W / 2, H * 0.45 + (i - (lines.length - 1) / 2) * fs * 1.1);
    });
    g.shadowBlur = 0;
    g.font = `${Math.round(H * 0.06)}px ${MONO}`; g.fillStyle = '#ff6a50';
    g.fillText(`CHOIR PRIORITY OVERRIDE  ·  CODE ${(s.seed % 900 + 100)}-R`, W / 2, H - b * 2.2);
  }

  private staticNoise(s: Screen) {
    const { g, W, H } = s;
    const img = s.noise!; const d = img.data; const r = s.rand;
    const roll = (s.t * 37) % img.height;
    for (let y = 0; y < img.height; y++) {
      const band = Math.abs(y - roll) < 4 ? 70 : 0;
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        const v = (r() * 200 + band) | 0;
        d[i] = v; d[i + 1] = v; d[i + 2] = v + 10; d[i + 3] = 255;
      }
    }
    s.noiseCv!.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(s.noiseCv!, 0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, W, H);
  }

  /** CHOIR's face: dozens of waveform lines pinched into an almond eye, an iris of circular waveforms. */
  private choir(s: Screen) {
    const { g, W, H } = s;
    const t = s.t;
    g.fillStyle = 'rgba(0,2,4,0.55)'; g.fillRect(0, 0, W, H); // persistence trail
    const cx = W / 2, cy = H / 2;
    const breath = 0.85 + 0.15 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.3);
    const eyeW = W * 0.44 * breath, eyeH = H * 0.34 * breath;
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1.2;
    const N = 44, M = 110;
    for (let i = 0; i < N; i++) {
      const v = i / (N - 1) * 2 - 1; // -1..1
      const off = Math.sign(v) * Math.pow(Math.abs(v), 0.8);
      const a = 0.18 + 0.5 * (1 - Math.abs(v));
      g.strokeStyle = i % 7 === 3 ? `rgba(235,250,255,${a})` : `rgba(60,220,255,${a * 0.8})`;
      g.beginPath();
      for (let j = 0; j <= M; j++) {
        const u = j / M * 2 - 1; // -1..1 across
        const x = cx + u * W * 0.5;
        const ex = Math.abs(u * W * 0.5) / eyeW;
        // almond envelope: lines open around the eye, pinch together at its corners and beyond
        const env = ex < 1 ? Math.sqrt(1 - ex * ex) : 0;
        const pinch = Math.exp(-Math.pow(Math.max(0, ex - 1) * 2.2, 2));
        const spread = (eyeH * env + H * 0.04 * (1 - pinch) + H * 0.012) * off;
        const amp = (0.25 + 0.75 * (1 - env)) * pinch * H * 0.035 * (0.6 + 0.4 * Math.sin(t * 3 + i));
        const wave = Math.sin(u * 22 + t * 5 + i * 0.7) * 0.6 + Math.sin(u * 61 - t * 9 + i * 1.3) * 0.3 + Math.sin(u * 7 + t * 1.3 + i) * 0.4;
        const y = cy + spread + amp * wave * (1 - Math.abs(off) * 0.4);
        if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // iris: concentric circular waveforms
    const R = eyeH * 0.62;
    for (let k = 0; k < 9; k++) {
      const rr = R * (0.35 + k * 0.08);
      g.strokeStyle = k === 4 ? 'rgba(240,252,255,0.85)' : `rgba(70,225,255,${0.25 + 0.06 * k})`;
      g.lineWidth = k === 4 ? 1.8 : 1;
      g.beginPath();
      for (let j = 0; j <= 96; j++) {
        const a = j / 96 * Math.PI * 2;
        const w = Math.sin(a * (5 + k) + t * (1.5 + k * 0.4)) * 0.06 + Math.sin(a * 17 - t * 4) * 0.025 * (k % 3);
        const r2 = rr * (1 + w) * (0.92 + 0.08 * Math.sin(t * 1.7 + k));
        const x = cx + Math.cos(a) * r2, y = cy + Math.sin(a) * r2;
        if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // pupil: dark void with a hot white core that dilates
    const pr = R * (0.22 + 0.06 * Math.sin(t * 0.7));
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.beginPath(); g.arc(cx, cy, pr, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'lighter';
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, pr * 0.9);
    cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(0.15, 'rgba(180,245,255,0.5)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, pr * 0.9, 0, Math.PI * 2); g.fill();
    // glitch rows
    g.globalCompositeOperation = 'source-over';
    if (s.rand() < 0.25) {
      const y = s.rand() * H, h = 2 + s.rand() * 10;
      g.drawImage(s.cv, 0, y, W, h, (s.rand() - 0.5) * 30, y, W, h);
    }
    g.fillStyle = 'rgba(120,230,255,0.6)';
    g.font = `${Math.round(H * 0.045)}px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'bottom';
    if (Math.floor(t * 1.5) % 2 === 0) g.fillText('WE ARE LISTENING', W * 0.04, H * 0.95);
  }

  private camera(s: Screen) {
    const { g, W, H } = s;
    const t = s.t; const r = s.rand;
    g.fillStyle = '#0b0f0d'; g.fillRect(0, 0, W, H);
    // abstract corridor in perspective
    const vx = W * 0.55 + Math.sin(t * 0.2) * 4, vy = H * 0.45;
    g.strokeStyle = 'rgba(150,180,160,0.5)'; g.lineWidth = 1.2;
    for (let k = 0; k < 7; k++) {
      const f = Math.pow(0.68, k); const w = W * 0.9 * f, h = H * 0.95 * f;
      g.strokeRect(vx - w / 2, vy - h / 2, w, h);
    }
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(vx, vy); g.stroke(); }
    // ceiling lights
    for (let k = 1; k < 6; k++) {
      const f = Math.pow(0.68, k); const ly = vy - H * 0.95 * f / 2 + 3;
      const lit = (Math.floor(t * 3 + k * 7) % 11) !== 0;
      g.fillStyle = lit ? 'rgba(210,235,215,0.8)' : 'rgba(60,70,65,0.6)';
      g.fillRect(vx - W * 0.1 * f, ly, W * 0.2 * f, Math.max(1, 4 * f));
    }
    // floor gradient + a shape that is not supposed to be there
    const fg = g.createLinearGradient(0, vy, 0, H); fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(120,150,130,0.25)');
    g.fillStyle = fg; g.fillRect(0, vy, W, H - vy);
    const phase = (t * 0.05) % 1;
    if (phase > 0.55 && phase < 0.75) {
      const f = 0.25 + (phase - 0.55) * 1.5;
      g.fillStyle = 'rgba(5,8,6,0.9)';
      g.beginPath(); g.ellipse(vx - W * 0.05, vy + H * 0.25 * f, W * 0.03 * f * 2, H * 0.2 * f * 2, 0, 0, Math.PI * 2); g.fill();
    }
    // grain
    for (let i = 0; i < 900; i++) { const v = (r() * 255) | 0; g.fillStyle = `rgba(${v},${v},${v},0.12)`; g.fillRect(r() * W, r() * H, 2, 2); }
    // scan roll bar
    const ry = (t * 40) % (H + 60) - 30;
    const rb = g.createLinearGradient(0, ry - 30, 0, ry + 30); rb.addColorStop(0, 'rgba(255,255,255,0)'); rb.addColorStop(0.5, 'rgba(200,230,210,0.08)'); rb.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rb; g.fillRect(0, ry - 30, W, 60);
    // OSD
    const fs = Math.max(10, Math.round(H / 18));
    g.font = `${fs}px ${MONO}`; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = 'rgba(230,240,232,0.9)';
    const sec = Math.floor(t + 11647);
    const hh = String(Math.floor(sec / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(sec / 60) % 60).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
    g.fillText(`CAM ${String((s.seed % 16) + 1).padStart(2, '0')}  ${this.camLabel}`, fs * 0.6, fs * 0.5);
    g.fillText(`2091-03-14  ${hh}:${mm}:${ss}`, fs * 0.6, H - fs * 1.6);
    if (Math.floor(t * 1.4) % 2 === 0) {
      g.fillStyle = '#ff2a20'; g.beginPath(); g.arc(W - fs * 3.6, fs * 1.05, fs * 0.38, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(230,240,232,0.9)'; g.fillText('REC', W - fs * 3.0, fs * 0.5);
    }
    // monochrome tint
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#b8d8c0'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }

  private vitals(s: Screen) {
    const { g, W, H } = s;
    const t = s.t;
    g.fillStyle = '#020605'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(40,90,70,0.35)'; g.lineWidth = 1;
    const gs = H / 10;
    for (let x = 0; x < W; x += gs) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += gs) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const traceW = W * 0.68;
    const traces: [string, number, number][] = [['#4dff7a', H * 0.22, 1.0], ['#40d8ff', H * 0.47, 0.5], ['#ffe14d', H * 0.72, 0.3]];
    const sweep = (t * traceW * 0.25) % traceW;
    for (const [col, y0, noiseAmp] of traces) {
      g.strokeStyle = col; g.lineWidth = 2; g.shadowColor = col; g.shadowBlur = 6;
      g.beginPath();
      for (let x = 0; x < traceW; x += 3) {
        if (Math.abs(x - sweep) < 10) { g.stroke(); g.beginPath(); continue; }
        const y = y0 + Math.sin(x * 0.9 + t * 13) * noiseAmp * 0.8 + Math.sin(x * 0.13 + t) * noiseAmp * 0.6;
        if (x === 0 || Math.abs(x - sweep - 12) < 3) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.shadowBlur = 0;
    const fs = Math.round(H * 0.075);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const x0 = traceW + W * 0.03;
    const blink = Math.floor(t * 2) % 2 === 0;
    g.font = `700 ${fs * 0.6}px ${SANS}`; g.fillStyle = '#4dff7a'; g.fillText('HR', x0, H * 0.13);
    g.font = `700 ${fs * 1.5}px ${SANS}`; g.fillText('0', x0, H * 0.24);
    g.font = `700 ${fs * 0.6}px ${SANS}`; g.fillStyle = '#40d8ff'; g.fillText('SpO₂', x0, H * 0.4);
    g.font = `700 ${fs * 1.3}px ${SANS}`; g.fillText('--', x0, H * 0.5);
    g.font = `700 ${fs * 0.6}px ${SANS}`; g.fillStyle = '#ffe14d'; g.fillText('RESP', x0, H * 0.65);
    g.font = `700 ${fs * 1.3}px ${SANS}`; g.fillText('0', x0, H * 0.75);
    if (blink) { g.fillStyle = '#ff2a1a'; g.fillRect(0, H * 0.86, W, H * 0.14); g.fillStyle = '#fff'; } else g.fillStyle = '#ff2a1a';
    g.font = `800 ${fs * 0.85}px ${SANS}`; g.textAlign = 'center';
    g.fillText(s.text ?? 'ASYSTOLE  ·  NO PATIENT RESPONSE', W / 2, H * 0.93);
    g.font = `${fs * 0.45}px ${MONO}`; g.fillStyle = 'rgba(160,220,190,0.7)'; g.textAlign = 'left';
    g.fillText('MED-3A  BED 4   REYES, S.   SEDATION PUMP: EMPTY', W * 0.02, H * 0.04 + fs * 0.3);
  }

  private door(s: Screen, mode: boolean | 'cycling') {
    const { g, W, H } = s;
    const t = s.t;
    const open = mode === true, cyc = mode === 'cycling';
    const pulse = open ? 1 : cyc ? 0.55 + 0.45 * Math.abs(Math.sin(t * 2.6)) : 0.75 + 0.25 * Math.sin(t * 4);
    g.fillStyle = open ? '#011006' : cyc ? '#140b01' : '#140101'; g.fillRect(0, 0, W, H);
    const col = open ? `rgba(60,255,110,${pulse})` : cyc ? `rgba(255,170,30,${pulse})` : `rgba(255,40,24,${pulse})`;
    g.strokeStyle = col; g.lineWidth = Math.max(3, H * 0.05);
    g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
    // icon
    const ix = H * 0.55, iy = H / 2, sz = H * 0.36;
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = sz * 0.16;
    if (open) {
      g.beginPath(); g.moveTo(ix - sz * 0.5, iy); g.lineTo(ix - sz * 0.1, iy + sz * 0.4); g.lineTo(ix + sz * 0.55, iy - sz * 0.45); g.stroke();
    } else if (cyc) {
      // a turning arc: the interlock is working on it
      const a0 = t * 4;
      g.beginPath(); g.arc(ix, iy, sz * 0.42, a0, a0 + Math.PI * 1.4); g.stroke();
    } else {
      g.fillRect(ix - sz * 0.5, iy - sz * 0.05, sz, sz * 0.75);
      g.beginPath(); g.arc(ix, iy - sz * 0.05, sz * 0.33, Math.PI, 0); g.stroke();
    }
    g.font = `800 ${Math.round(H * 0.34)}px ${SANS}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = col;
    let label = (s.text ?? (open ? 'OPEN' : cyc ? 'CYCLING' : 'LOCKED')).toUpperCase();
    let sz2 = H * 0.34;
    while (g.measureText(label).width > W - H * 1.1 && sz2 > 8) { sz2 -= 2; g.font = `800 ${Math.round(sz2)}px ${SANS}`; }
    g.fillText(label, H * 0.98, H / 2);
    label = '';
  }
  // ───────────────────────────── REVISION 6: the core's option cards and palm plates

  /**
   * One service unit as a pictogram, feet at (x, y), `h` tall. `up`: awake, head up, lit (filled); otherwise
   * switched off: head on its chest, arms hanging, a dim outline. `dir` = which way it faces (+1 right, −1 left).
   */
  private unit(g: CanvasRenderingContext2D, x: number, y: number, h: number, up: boolean, dir: number, col: string, dim: string) {
    const hw = h * 0.15, legW = h * 0.105;
    g.lineWidth = Math.max(1, h * 0.035);
    g.fillStyle = col; g.strokeStyle = up ? col : dim;
    const part = (px: number, py: number, w: number, hh: number) => { if (up) g.fillRect(px, py, w, hh); else g.strokeRect(px, py, w, hh); };
    // legs, torso, arms
    part(x - hw, y - h * 0.4, legW, h * 0.4); part(x + hw - legW, y - h * 0.4, legW, h * 0.4);
    part(x - hw, y - h * 0.74, hw * 2, h * 0.32);
    const drop = up ? 0 : h * 0.05;
    part(x - hw - legW * 0.95, y - h * 0.73 + drop, legW * 0.7, h * 0.34); part(x + hw + legW * 0.25, y - h * 0.73 + drop, legW * 0.7, h * 0.34);
    // head: up and looking `dir`, or dropped forward onto the chest
    const hr = h * 0.105;
    const hx = up ? x : x + dir * h * 0.07, hy = up ? y - h * 0.88 : y - h * 0.775;
    g.beginPath(); g.arc(hx, hy, hr, 0, Math.PI * 2);
    if (up) {
      g.fill();
      // the visor: a dark slot on the side it faces
      g.fillStyle = 'rgba(0,0,0,0.85)';
      g.fillRect(hx + (dir > 0 ? hr * 0.1 : -hr * 0.95), hy - hr * 0.22, hr * 0.85, hr * 0.44);
    } else g.stroke();
  }

  /**
   * Option card of the core (REVISION 6 / 6.1). `text` = the number of units left on the line.
   * Two layouts: WIDE (the 12 × 3.6 m side walls) — headline block at the card's NORTH end (the end the door sees
   * head-on: right on the west wall = STOP, left on the east wall = COMMAND), pictogram toward the south — and
   * COMPACT (the eye above the pedestal, the pedestal screen), everything stacked.
   */
  private choice(s: Screen, stop: boolean) {
    const { g, W, H } = s;
    const t = s.t;
    const nRaw = parseInt(s.text ?? '32', 10);
    const n = Math.max(0, Math.min(32, Number.isFinite(nRaw) ? nRaw : 32));
    const rgb = stop ? '255,158,44' : '244,247,250';
    const C = (a: number) => `rgba(${rgb},${a})`;
    const bg = stop ? '#0d0702' : '#06070a';
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const wide = W / H >= 2.4;
    const head = stop ? 'STOP' : 'COMMAND';
    const sub = stop ? 'NODE 5 OFF' : 'SUPERVISOR: REYES, S.';
    const fate = stop ? 'THEY DO NOT WAKE' : 'THEY STAY AWAKE';
    const count = stop ? `UNITS ON THIS LINE: ${n} → 0` : `UNITS AWAITING ORDERS: ${n}`;
    const plate = stop ? 'AMBER PLATE' : 'WHITE PLATE';
    // The pictogram's clock: the units go dark one after another (STOP) / a glance runs down the row (COMMAND).
    const P = 8, ph = (t % P) / P;
    const litCount = !stop ? n : ph < 0.14 ? n : ph < 0.68 ? Math.round(n * (1 - (ph - 0.14) / 0.54)) : 0;
    const fit = (txt: string, weight: number, size: number, maxW: number) => {
      let sz = size; g.font = `${weight} ${Math.round(sz)}px ${SANS}`;
      while (g.measureText(txt).width > maxW && sz > 8) { sz -= Math.max(1, sz * 0.03); g.font = `${weight} ${Math.round(sz)}px ${SANS}`; }
      return sz;
    };
    /** n units in rows inside a box; `toward` = the side (+1 right / −1 left) the awake ones look to. */
    const rows = (x0: number, y0: number, w: number, h: number, toward: number) => {
      const perRow = n > 16 ? 16 : Math.max(1, n), nRows = n > 16 ? 2 : 1;
      const cell = w / (n > 16 ? 16 : Math.max(8, perRow));
      const fh = Math.min(h / nRows * 0.88, cell * 2.5);
      const rowW = cell * perRow;
      for (let i = 0; i < n; i++) {
        // column 0 stands next to the node / the supervisor (the side they face); a short row closes up to it.
        // STOP: the ones furthest away go dark first. COMMAND: a glance runs out from the supervisor.
        const r = Math.floor(i / perRow), c = i % perRow;
        const k = toward > 0 ? perRow - 1 - c : c;
        const x = x0 + (w - rowW) / 2 + (k + 0.5) * cell;
        const y = y0 + (h / nRows) * (r + 1) - (h / nRows - fh) * 0.5;
        const idx = r * perRow + c;
        const up = stop ? idx < litCount : true;
        let a = 1;
        if (!stop) { const wave = ((ph * 2.2 - c / perRow * 0.7 - r * 0.08) % 1 + 1) % 1; a = 0.72 + 0.28 * Math.max(0, 1 - Math.abs(wave - 0.1) * 6); }
        this.unit(g, x, y, fh, up, toward, C(a), C(0.34));
      }
    };
    /** The thing the row answers to: NODE 5 (a box that goes dark) / one larger outlined person. */
    const anchor = (cx: number, y0: number, h: number) => {
      g.lineWidth = Math.max(2, h * 0.022);
      if (stop) {
        const on = litCount > 0;
        const bw = h * 0.62, bh = h * 0.62, bx = cx - bw / 2, by = y0 + h * 0.1;
        g.strokeStyle = C(on ? 1 : 0.4); g.strokeRect(bx, by, bw, bh);
        if (on) { g.fillStyle = C(0.16); g.fillRect(bx, by, bw, bh); }
        // power symbol
        const r = bh * 0.24, py = by + bh * 0.56;
        g.beginPath(); g.arc(cx, py, r, -Math.PI * 0.32, Math.PI * 1.32); g.stroke();
        g.beginPath(); g.moveTo(cx, py - r * 1.35); g.lineTo(cx, py - r * 0.2); g.stroke();
        g.fillStyle = C(on ? 1 : 0.5); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `800 ${Math.round(h * 0.13)}px ${SANS}`;
        g.fillText('NODE 5', cx, by + bh + h * 0.13);
      } else {
        // a person, outlined, taller than the units: head, shoulders, body — and a raised open hand
        const ph2 = h * 0.86, fy = y0 + h * 0.94, hw = ph2 * 0.17;
        g.strokeStyle = C(1);
        g.beginPath(); g.arc(cx, fy - ph2 * 0.88, ph2 * 0.11, 0, Math.PI * 2); g.stroke();
        g.strokeRect(cx - hw, fy - ph2 * 0.74, hw * 2, ph2 * 0.34);
        g.strokeRect(cx - hw, fy - ph2 * 0.4, hw * 0.8, ph2 * 0.4); g.strokeRect(cx + hw * 0.2, fy - ph2 * 0.4, hw * 0.8, ph2 * 0.4);
        g.fillStyle = C(1); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `800 ${Math.round(h * 0.1)}px ${SANS}`;
        g.fillText('YOU', cx, fy - ph2 * 0.57);
      }
    };
    g.textBaseline = 'middle';
    if (wide) {
      const m = H * 0.06;
      g.strokeStyle = C(0.85); g.lineWidth = Math.max(3, H * 0.012);
      g.strokeRect(m * 0.5, m * 0.5, W - m, H - m);
      // north-origin spans → canvas x (the west wall's north end is on the right of its screen)
      // (seen from inside the room, north is on the LEFT of the west wall's screen and on the RIGHT of the east wall's)
      const span = (u0: number, u1: number): [number, number] => (stop ? [u0 * W, u1 * W] : [(1 - u1) * W, (1 - u0) * W]);
      // pictogram at the north end, the words from the centre on: what the door sees without turning (z < −78.7)
      const [px0, px1] = span(0.03, 0.385);
      const [hx0, hx1] = span(0.42, 0.965);
      const hw = hx1 - hx0;
      // divider
      const dx = stop ? hx0 - W * 0.0175 : hx1 + W * 0.0175;
      g.fillStyle = C(0.5); g.fillRect(dx - 1.5, m * 1.6, 3, H - m * 3.2);
      // headline block
      g.textAlign = 'left';
      g.fillStyle = C(1); g.fillRect(hx0, H * 0.085, H * 0.07, H * 0.07);
      g.font = `700 ${Math.round(H * 0.075)}px ${SANS}`; g.fillStyle = C(0.9);
      g.fillText(plate, hx0 + H * 0.1, H * 0.123);
      // both cards use the size at which COMMAND fits: the two words weigh the same
      const hs = fit('COMMAND', 900, H * 0.42, hw * 0.98);
      g.font = `900 ${Math.round(hs)}px ${SANS}`;
      g.save(); g.shadowColor = C(0.9); g.shadowBlur = H * 0.05; g.fillStyle = C(1);
      g.fillText(head, hx0 - hs * 0.03, H * 0.385);
      g.restore();
      fit(sub, 700, H * 0.105, hw * 0.98); g.fillStyle = C(0.92);
      g.fillText(sub, hx0, H * 0.635);
      // the consequence, inverted: the line that must be read
      const fs = fit(fate, 900, H * 0.115, hw * 0.9);
      const fw = g.measureText(fate).width;
      g.fillStyle = C(1); g.fillRect(hx0, H * 0.745, fw + fs * 0.7, H * 0.165);
      g.fillStyle = bg; g.fillText(fate, hx0 + fs * 0.35, H * 0.832);
      // pictogram block: the anchor on the headline's side, the row beyond it
      const pw = px1 - px0, aw = pw * 0.2;
      const ax = stop ? px1 - aw / 2 : px0 + aw / 2;
      anchor(ax, H * 0.09, H * 0.6);
      rows(stop ? px0 : px0 + aw + pw * 0.02, H * 0.1, pw - aw - pw * 0.02, H * 0.58, stop ? 1 : -1);
      fit(count, 800, H * 0.115, pw * 0.98); g.fillStyle = C(1); g.textAlign = 'left';
      g.fillText(count, px0, H * 0.832);
    } else {
      const m = H * 0.05;
      g.strokeStyle = C(0.85); g.lineWidth = Math.max(2, H * 0.014);
      g.strokeRect(m * 0.5, m * 0.5, W - m, H - m);
      g.textAlign = 'center';
      const hs = fit('COMMAND', 900, H * 0.3, W * 0.8);
      g.font = `900 ${Math.round(hs)}px ${SANS}`;
      g.save(); g.shadowColor = C(0.9); g.shadowBlur = H * 0.05; g.fillStyle = C(1);
      g.fillText(head, W / 2, H * 0.2);
      g.restore();
      fit(sub, 700, H * 0.085, W * 0.86); g.fillStyle = C(0.92);
      g.fillText(sub, W / 2, H * 0.385);
      rows(W * 0.07, H * 0.45, W * 0.86, H * 0.3, stop ? 1 : -1);
      fit(count, 800, H * 0.08, W * 0.88); g.fillStyle = C(1);
      g.fillText(count, W / 2, H * 0.825);
      const fs = fit(fate, 900, H * 0.08, W * 0.8);
      const fw = g.measureText(fate).width;
      g.fillStyle = C(1); g.fillRect(W / 2 - fw / 2 - fs * 0.4, H * 0.875, fw + fs * 0.8, H * 0.095);
      g.fillStyle = bg; g.fillText(fate, W / 2, H * 0.925);
    }
  }

  /**
   * Palm plate (REVISION 6). `text` = "<amber|white>|<state>|<LABEL>|<scan seconds>"; state: off, standby (not
   * yet armed), idle (armed: outline of a left hand, a slow scan line), scan (a bar fills over the scan time),
   * done (REYES, S. — LIVING — ROSTERED), fail (SCAN INCOMPLETE). The top of the canvas is the far edge of the
   * plate, so the fingers of the outline point away from whoever stands in front of it.
   */
  private palm(s: Screen) {
    const { g, W, H } = s;
    const t = s.t;
    const [colour = 'amber', state = 'idle', label = '', secs = '1.6'] = (s.text ?? '').split('|');
    const rgb = colour === 'amber' ? '255,158,44' : '244,247,250';
    const C = (a: number) => `rgba(${rgb},${a})`;
    const bg = colour === 'amber' ? '#0b0602' : '#05060a';
    g.fillStyle = state === 'off' ? '#010101' : bg; g.fillRect(0, 0, W, H);
    if (state === 'off') return;
    const live = state !== 'standby';
    const blink = Math.floor(t * 3) % 2 === 0;
    const edge = state === 'standby' ? 0.3 : state === 'fail' ? (blink ? 1 : 0.35) : state === 'idle' ? 0.75 + 0.2 * Math.sin(t * 2.2) : 1;
    g.strokeStyle = C(edge); g.lineWidth = H * 0.018;
    g.strokeRect(H * 0.03, H * 0.03, W - H * 0.06, H - H * 0.06);
    // the hand (left, palm down, seen from above: thumb on the right). Units: plate height = 0.32 m.
    const u = H / 0.42, cx = W * 0.5, wy = H * 0.86;
    const shape = (grow: number) => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      const fingers: [number, number, number, number][] = [[0.031, 0.163, 0.020, 0.06], [0.010, 0.178, 0.021, 0.02], [-0.011, 0.170, 0.020, -0.03], [-0.031, 0.146, 0.018, -0.09]];
      for (const [fx, len, w, lean] of fingers) {
        g.lineWidth = w * u + grow;
        g.beginPath(); g.moveTo(cx + fx * u, wy - 0.07 * u); g.lineTo(cx + (fx + lean * 0.35) * u, wy - len * u); g.stroke();
      }
      // thumb
      g.lineWidth = 0.023 * u + grow;
      g.beginPath(); g.moveTo(cx + 0.03 * u, wy - 0.035 * u); g.lineTo(cx + 0.079 * u, wy - 0.088 * u); g.stroke();
      // palm
      g.lineWidth = 0.03 * u + grow;
      g.beginPath(); g.moveTo(cx - 0.027 * u, wy - 0.02 * u); g.lineTo(cx + 0.027 * u, wy - 0.02 * u); g.lineTo(cx + 0.027 * u, wy - 0.085 * u); g.lineTo(cx - 0.027 * u, wy - 0.085 * u); g.closePath(); g.stroke(); g.fill();
    };
    const handA = state === 'standby' ? 0.3 : state === 'fail' ? (blink ? 0.9 : 0.3) : state === 'idle' ? 0.8 : 1;
    g.save(); g.shadowColor = C(0.9); g.shadowBlur = live ? H * 0.05 : 0;
    g.strokeStyle = C(handA); g.fillStyle = C(handA); shape(H * 0.034);
    g.restore();
    // an opaque inner pass over the bright outer one leaves an outline; reading / read: the inside fills
    const fillA = state === 'done' ? 0.5 : state === 'scan' ? 0.16 : 0;
    g.strokeStyle = bg; g.fillStyle = bg; shape(0);
    if (fillA > 0) { g.strokeStyle = C(fillA); g.fillStyle = C(fillA); shape(-1); }
    // scan line across the hand
    if (state === 'idle' || state === 'scan') {
      const k = state === 'scan' ? (t * 1.9) % 1 : 0.5 + 0.5 * Math.sin(t * 1.3);
      const y = H * 0.36 + k * H * 0.5;
      const lg = g.createLinearGradient(0, y - H * 0.05, 0, y + H * 0.05);
      lg.addColorStop(0, C(0)); lg.addColorStop(0.5, C(state === 'scan' ? 0.95 : 0.55)); lg.addColorStop(1, C(0));
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = lg; g.fillRect(W * 0.12, y - H * 0.05, W * 0.76, H * 0.1);
      g.globalCompositeOperation = 'source-over';
    }
    // the far edge of the plate stays in sight above the fingers: which option this is, and the status line
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C(live ? 1 : 0.4);
    g.font = `900 ${Math.round(H * 0.125)}px ${SANS}`;
    g.fillText(label, cx, H * 0.125);
    g.font = `800 ${Math.round(H * 0.06)}px ${SANS}`;
    const line = (txt: string, a = 1) => { g.fillStyle = C(a); g.fillText(txt, cx, H * 0.25); };
    if (state === 'standby') line('STANDBY', 0.45);
    else if (state === 'idle') line('PLACE PALM', 0.6 + 0.4 * Math.abs(Math.sin(t * 1.6)));
    else if (state === 'fail') line('SCAN INCOMPLETE', blink ? 1 : 0.4);
    else if (state === 'done') {
      g.fillStyle = C(1); g.fillRect(H * 0.07, H * 0.2, W - H * 0.14, H * 0.1);
      g.fillStyle = bg; g.font = `900 ${Math.round(H * 0.054)}px ${SANS}`;
      g.fillText('REYES, S. — LIVING — ROSTERED', cx, H * 0.252);
    } else if (state === 'scan') {
      const dur = Math.max(0.2, Number(secs) || 1.6), k = Math.min(1, t / dur);
      g.strokeStyle = C(1); g.lineWidth = H * 0.008;
      g.strokeRect(W * 0.12, H * 0.215, W * 0.76, H * 0.07);
      g.fillStyle = C(1); g.fillRect(W * 0.12, H * 0.215, W * 0.76 * k, H * 0.07);
    }
  }
}
