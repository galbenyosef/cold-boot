/**
 * Canvas-2D signage: industrial labels, warning / danger plates, directional room signs, stencilled
 * wall lettering. Wear (scratches, dirt, fading, chipped edges) is composited so they sit in the world.
 * The sign texture covers the whole quad (UV 0..1); `aspect` = quad width / height.
 */
import * as THREE from 'three';
import type { SignStyle } from '../core/types';

const SANS = '"Arial Narrow", "Helvetica Neue", "Roboto Condensed", Arial, sans-serif';
const MONO = 'ui-monospace, Menlo, "SF Mono", Consolas, monospace';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
function hashStr(t: string) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

type Ctx = CanvasRenderingContext2D;

/** Fit text into a box by shrinking the font size. */
function fitText(g: Ctx, text: string, maxW: number, size: number, weight: string, family: string) {
  let s = size;
  g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(text).width > maxW && s > 8) { s -= 1; g.font = `${weight} ${s}px ${family}`; }
  return s;
}

function drawStripes(g: Ctx, x: number, y: number, w: number, h: number, a: string, b: string, period: number) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = a; g.fillRect(x, y, w, h);
  g.fillStyle = b;
  for (let i = -h; i < w + h; i += period) {
    g.beginPath();
    g.moveTo(x + i, y + h); g.lineTo(x + i + period / 2, y + h); g.lineTo(x + i + period / 2 + h, y); g.lineTo(x + i + h, y);
    g.closePath(); g.fill();
  }
  g.restore();
}

function warningTriangle(g: Ctx, cx: number, cy: number, size: number, fill: string, ink: string) {
  const h = size * 0.866;
  g.save();
  g.lineJoin = 'round';
  g.beginPath(); g.moveTo(cx, cy - h / 2); g.lineTo(cx + size / 2, cy + h / 2); g.lineTo(cx - size / 2, cy + h / 2); g.closePath();
  g.fillStyle = ink; g.fill();
  const s2 = size * 0.78, h2 = s2 * 0.866, oy = (h - h2) * 0.18;
  g.beginPath(); g.moveTo(cx, cy - h2 / 2 + oy); g.lineTo(cx + s2 / 2, cy + h2 / 2 - oy * 0.3); g.lineTo(cx - s2 / 2, cy + h2 / 2 - oy * 0.3); g.closePath();
  g.fillStyle = fill; g.fill();
  g.fillStyle = ink;
  g.font = `900 ${Math.round(size * 0.5)}px ${SANS}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', cx, cy + h * 0.1);
  g.restore();
}

function arrow(g: Ctx, cx: number, cy: number, size: number, dir: 'left' | 'right' | 'up' | 'down', color: string) {
  g.save();
  g.translate(cx, cy);
  g.rotate({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir]);
  g.fillStyle = color;
  const s = size / 2;
  g.beginPath();
  g.moveTo(-s, -s * 0.28); g.lineTo(s * 0.15, -s * 0.28); g.lineTo(s * 0.15, -s * 0.75); g.lineTo(s, 0);
  g.lineTo(s * 0.15, s * 0.75); g.lineTo(s * 0.15, s * 0.28); g.lineTo(-s, s * 0.28); g.closePath();
  g.fill();
  g.restore();
}

function screw(g: Ctx, x: number, y: number, r: number, rand: () => number) {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gr.addColorStop(0, '#b8bcbf'); gr.addColorStop(0.6, '#6a6e72'); gr.addColorStop(1, '#2a2c2e');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a1b1c'; g.lineWidth = r * 0.25;
  const a = rand() * Math.PI;
  g.beginPath(); g.moveTo(x - Math.cos(a) * r * 0.7, y - Math.sin(a) * r * 0.7); g.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7); g.stroke();
  // rust halo
  const rg = g.createRadialGradient(x, y + r, 0, x, y + r * 2, r * 3);
  rg.addColorStop(0, 'rgba(90,45,20,0.35)'); rg.addColorStop(1, 'rgba(90,45,20,0)');
  g.fillStyle = rg; g.fillRect(x - r * 3, y - r, r * 6, r * 6);
}

/** Dirt, scratches, fading, edge grime. `rough` canvas gets matching roughness changes. */
function weather(g: Ctx, rg: Ctx, w: number, h: number, rand: () => number, amount: number, paintOnly = false) {
  // fading / chalking
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 18 * amount; i++) {
    const x = rand() * w, y = rand() * h, r = (0.1 + rand() * 0.35) * Math.max(w, h);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.6;
    gr.addColorStop(0, dark ? `rgba(30,24,18,${0.12 + rand() * 0.2})` : `rgba(220,215,200,${0.05 + rand() * 0.08})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  // grime gradient at the bottom + edges (dust settles, hands touch the edges)
  const bg = g.createLinearGradient(0, h, 0, h * 0.55);
  bg.addColorStop(0, `rgba(25,20,15,${0.35 * amount})`); bg.addColorStop(1, 'rgba(25,20,15,0)');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (!paintOnly) {
    const e = Math.min(w, h) * 0.08;
    for (const [x0, y0, x1, y1] of [[0, 0, e, 0], [w, 0, w - e, 0], [0, 0, 0, e], [0, h, 0, h - e]] as const) {
      const lg = g.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, `rgba(20,16,12,${0.4 * amount})`); lg.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = lg; g.fillRect(0, 0, w, h);
    }
  }
  // drip streaks
  for (let i = 0; i < 10 * amount; i++) {
    const x = rand() * w, y = rand() * h * 0.4, len = (0.2 + rand() * 0.8) * h, ww = 1 + rand() * 3;
    const lg = g.createLinearGradient(0, y, 0, y + len);
    lg.addColorStop(0, `rgba(40,28,18,${0.25 + rand() * 0.2})`); lg.addColorStop(1, 'rgba(40,28,18,0)');
    g.fillStyle = lg; g.fillRect(x, y, ww, len);
  }
  // speckle
  for (let i = 0; i < w * h * 0.002 * amount; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(15,12,10,${rand() * 0.5})` : `rgba(200,195,180,${rand() * 0.25})`;
    const s = 0.5 + rand() * 1.8;
    g.fillRect(rand() * w, rand() * h, s, s);
  }
  // scratches: light thin strokes (paint scraped to metal)
  g.lineCap = 'round';
  rg.lineCap = 'round';
  for (let i = 0; i < 40 * amount; i++) {
    const x = rand() * w, y = rand() * h, a = (rand() - 0.5) * 1.2 + (rand() < 0.3 ? Math.PI / 2 : 0), l = (0.02 + rand() * 0.15) * w;
    const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l;
    g.strokeStyle = `rgba(190,192,190,${0.15 + rand() * 0.45})`;
    g.lineWidth = 0.6 + rand() * 1.4;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + (rand() - 0.5) * 6, (y + y2) / 2 + (rand() - 0.5) * 6, x2, y2); g.stroke();
    rg.strokeStyle = 'rgb(120,120,120)'; rg.lineWidth = g.lineWidth;
    rg.beginPath(); rg.moveTo(x, y); rg.lineTo(x2, y2); rg.stroke();
  }
  // chips: irregular blobs exposing primer / metal
  for (let i = 0; i < 14 * amount; i++) {
    const edge = rand() < 0.7;
    let x = rand() * w, y = rand() * h;
    if (edge) { if (rand() < 0.5) x = rand() < 0.5 ? rand() * 8 : w - rand() * 8; else y = rand() < 0.5 ? rand() * 8 : h - rand() * 8; }
    const r = 1.5 + rand() * 6;
    g.fillStyle = rand() < 0.5 ? '#6f7377' : '#5a3a2a';
    rg.fillStyle = 'rgb(90,90,90)';
    for (const c of [g, rg]) {
      c.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2, rr = r * (0.5 + rand() * 0.7);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath(); c.fill();
    }
  }
  g.restore();
}

function parseArrow(text: string): { text: string; dir: 'left' | 'right' | 'up' | 'down' | null; side: 'left' | 'right' } {
  let t = text.trim();
  const map: Record<string, 'left' | 'right' | 'up' | 'down'> = { '<': 'left', '←': 'left', '>': 'right', '→': 'right', '^': 'up', '↑': 'up', 'v': 'down', '↓': 'down' };
  let dir: 'left' | 'right' | 'up' | 'down' | null = null; let side: 'left' | 'right' = 'left';
  const first = t[0], last = t[t.length - 1];
  if (first in map && (t[1] === ' ' || t.length === 1)) { dir = map[first]; t = t.slice(1).trim(); side = 'left'; }
  else if (last in map && t[t.length - 2] === ' ') { dir = map[last]; t = t.slice(0, -1).trim(); side = 'right'; }
  return { text: t, dir, side };
}

export function createSign(text: string, style: SignStyle, aspect: number, maxAniso: number): THREE.MeshStandardMaterial {
  const H = aspect >= 4 ? 192 : 256;
  const W = Math.min(2048, Math.max(64, Math.round(H * aspect)));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
  const g = cv.getContext('2d')!; const rg = rc.getContext('2d')!;
  const rand = rng(hashStr(style + text + aspect));
  const lines = text.split('\n');
  const pad = H * 0.08;
  let roughBase = 150; // 0..255 → roughness ~0.6
  let transparent = false;

  if (style === 'label') {
    g.fillStyle = '#c9c6b8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = H * 0.035; g.strokeRect(pad * 0.6, pad * 0.6, W - pad * 1.2, H - pad * 1.2);
    g.fillStyle = '#161616'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length;
    const lh = (H - pad * 3) / n;
    lines.forEach((ln, i) => {
      const size = fitText(g, ln, W - pad * 4, Math.min(lh * 0.8, H * 0.5), i === 0 ? '700' : '600', i === 0 ? SANS : MONO);
      void size;
      g.fillText(ln, W / 2, pad * 1.5 + lh * (i + 0.5));
    });
    // tiny part number bottom-right
    g.font = `500 ${Math.round(H * 0.06)}px ${MONO}`; g.textAlign = 'right'; g.fillStyle = '#3a3a36';
    g.fillText(`HD-${(hashStr(text) % 9000 + 1000)}-E3`, W - pad * 1.1, H - pad * 1.0);
    for (const [x, y] of [[pad * 0.35, pad * 0.35], [W - pad * 0.35, pad * 0.35], [pad * 0.35, H - pad * 0.35], [W - pad * 0.35, H - pad * 0.35]]) screw(g, x, y, H * 0.025, rand);
    roughBase = 120;
    weather(g, rg, W, H, rand, 0.8);
  } else if (style === 'warning') {
    g.fillStyle = '#d9a813'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#111'; g.lineWidth = H * 0.05; g.strokeRect(pad * 0.5, pad * 0.5, W - pad, H - pad);
    const tri = H * 0.7;
    const hasRoom = W > H * 1.3;
    warningTriangle(g, hasRoom ? pad + tri * 0.55 : W / 2, H / 2 + (hasRoom ? 0 : -H * 0.12), hasRoom ? tri : tri * 0.6, '#d9a813', '#111');
    g.fillStyle = '#111'; g.textBaseline = 'middle';
    if (hasRoom) {
      g.textAlign = 'left';
      const x0 = pad * 2 + tri * 1.05; const n = lines.length; const lh = (H - pad * 3) / n;
      lines.forEach((ln, i) => { fitText(g, ln.toUpperCase(), W - x0 - pad * 1.5, Math.min(lh * 0.82, H * 0.42), '800', SANS); g.fillText(ln.toUpperCase(), x0, pad * 1.5 + lh * (i + 0.5)); });
    } else {
      g.textAlign = 'center';
      fitText(g, lines[0].toUpperCase(), W - pad * 2.5, H * 0.18, '800', SANS);
      g.fillText(lines[0].toUpperCase(), W / 2, H * 0.82);
    }
    weather(g, rg, W, H, rand, 1.0);
  } else if (style === 'danger') {
    const band = H * 0.2;
    drawStripes(g, 0, 0, W, band, '#d6a512', '#121212', band * 1.4);
    drawStripes(g, 0, H - band, W, band, '#d6a512', '#121212', band * 1.4);
    g.fillStyle = '#a3140f'; g.fillRect(0, band, W, H - band * 2);
    g.fillStyle = '#f0ece4'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length; const lh = (H - band * 2 - pad) / n;
    lines.forEach((ln, i) => { fitText(g, ln.toUpperCase(), W - pad * 3, Math.min(lh * 0.85, H * 0.4), '900', SANS); g.fillText(ln.toUpperCase(), W / 2, band + pad / 2 + lh * (i + 0.5)); });
    weather(g, rg, W, H, rand, 1.1);
  } else if (style === 'directional') {
    const { text: t, dir, side } = parseArrow(text);
    g.fillStyle = '#1d3a34'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.15)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e8e6de'; g.lineWidth = H * 0.025; g.strokeRect(pad * 0.5, pad * 0.5, W - pad, H - pad);
    g.fillStyle = '#ecebe4'; g.textBaseline = 'middle';
    const asz = H * 0.62;
    let x0 = pad * 1.6, x1 = W - pad * 1.6;
    if (dir) {
      const ax = side === 'left' ? pad * 1.4 + asz / 2 : W - pad * 1.4 - asz / 2;
      arrow(g, ax, H / 2, asz, dir, '#ecebe4');
      if (side === 'left') x0 = ax + asz * 0.65; else x1 = ax - asz * 0.65;
    }
    const tl = t.split('\n');
    const lh = (H - pad * 2.5) / tl.length;
    g.textAlign = side === 'right' && dir ? 'right' : 'left';
    tl.forEach((ln, i) => {
      fitText(g, ln.toUpperCase(), x1 - x0, Math.min(lh * (i === 0 ? 0.8 : 0.55), H * 0.5), i === 0 ? '700' : '500', SANS);
      g.fillText(ln.toUpperCase(), g.textAlign === 'right' ? x1 : x0, pad * 1.25 + lh * (i + 0.5));
    });
    roughBase = 110;
    weather(g, rg, W, H, rand, 0.7);
  } else { // stencil — transparent spray paint
    transparent = true;
    g.clearRect(0, 0, W, H);
    const color = /^(DANGER|NO |KEEP|HIGH|WARNING)/i.test(text) ? '#b88c14' : '#b9b5aa';
    const n = lines.length; const lh = H / n;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // overspray halo
    g.save();
    g.filter = `blur(${Math.max(2, H * 0.025)}px)`;
    g.fillStyle = color; g.globalAlpha = 0.35;
    lines.forEach((ln, i) => { fitText(g, ln.toUpperCase(), W * 0.92, lh * 0.82, '900', SANS); g.fillText(ln.toUpperCase(), W / 2, lh * (i + 0.5)); });
    g.restore();
    g.fillStyle = color;
    lines.forEach((ln, i) => { fitText(g, ln.toUpperCase(), W * 0.92, lh * 0.82, '900', SANS); g.fillText(ln.toUpperCase(), W / 2, lh * (i + 0.5)); });
    // stencil bridges: horizontal gaps through the letters
    g.globalCompositeOperation = 'destination-out';
    lines.forEach((_, i) => {
      const y = lh * (i + 0.5);
      g.fillStyle = 'rgba(0,0,0,1)';
      g.fillRect(0, y - lh * 0.03, W, lh * 0.05);
    });
    // wear: patchy dropouts + scratches through the paint
    for (let i = 0; i < 160; i++) {
      const x = rand() * W, y = rand() * H, r = 1 + rand() * H * 0.05;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${0.3 + rand() * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const x = rand() * W, y = rand() * H, a = (rand() - 0.5) * 0.8, l = (0.05 + rand() * 0.3) * W;
      g.strokeStyle = `rgba(0,0,0,${0.5 + rand() * 0.5})`; g.lineWidth = 0.7 + rand() * 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // spray speckle around
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = color;
    for (let i = 0; i < W * H * 0.004; i++) { g.globalAlpha = rand() * 0.5; g.fillRect(rand() * W, rand() * H, 1, 1); }
    // paint runs
    g.globalAlpha = 0.6;
    for (let i = 0; i < 6; i++) {
      const x = W * (0.1 + rand() * 0.8), y = H * (0.3 + rand() * 0.4), len = H * (0.1 + rand() * 0.35);
      const lg = g.createLinearGradient(0, y, 0, y + len); lg.addColorStop(0, color); lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg; g.fillRect(x, y, 1.5 + rand() * 1.5, len);
    }
    g.globalAlpha = 1;
    roughBase = 190;
  }

  // roughness canvas: base + weather marks already drawn in rg (darker = smoother)
  rg.globalCompositeOperation = 'destination-over';
  rg.fillStyle = `rgb(${roughBase},${roughBase},${roughBase})`;
  rg.fillRect(0, 0, W, H);
  rg.globalCompositeOperation = 'source-over';

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(8, maxAniso);
  const rough = new THREE.CanvasTexture(rc);
  rough.colorSpace = THREE.NoColorSpace;
  for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
  const m = new THREE.MeshStandardMaterial({
    name: `sign_${style}`,
    map, roughnessMap: rough, roughness: 1, metalness: 0,
  });
  if (transparent) {
    m.transparent = true; m.depthWrite = false;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  }
  return m;
}
