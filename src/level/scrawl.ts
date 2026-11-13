/**
 * Hand-made wall text: marker on cloth, letters scratched into paint, words slapped on with a brush.
 * Drawn with a tiny single-stroke vector alphabet (so it looks written, not typeset, and is identical on
 * every machine — no system fonts involved): every glyph is jittered, rotated and re-drawn per style.
 */
import * as THREE from 'three';
import { rng, type Rng } from './builder';

/** Glyphs on a 4 × 6 grid (y up). `w` = advance width; strokes are flat x,y lists. */
const G: Record<string, { w: number; s: number[][] }> = {
  A: { w: 4, s: [[0, 0, 2, 6, 4, 0], [0.9, 2.2, 3.1, 2.2]] },
  B: { w: 3.8, s: [[0, 0, 0, 6, 2.5, 6, 3.4, 4.8, 2.5, 3.2, 0, 3.2], [2.5, 3.2, 3.8, 1.8, 2.9, 0, 0, 0]] },
  C: { w: 3.8, s: [[3.8, 4.9, 2.4, 6, 0.8, 5.2, 0, 3, 0.8, 0.8, 2.4, 0, 3.8, 1.1]] },
  D: { w: 3.8, s: [[0, 0, 0, 6, 2, 6, 3.7, 4.3, 3.7, 1.7, 2, 0, 0, 0]] },
  E: { w: 3.5, s: [[3.5, 6, 0, 6, 0, 0, 3.5, 0], [0, 3.1, 2.7, 3.1]] },
  F: { w: 3.4, s: [[3.4, 6, 0, 6, 0, 0], [0, 3.1, 2.6, 3.1]] },
  G: { w: 3.9, s: [[3.8, 4.9, 2.4, 6, 0.8, 5.2, 0, 3, 0.8, 0.8, 2.4, 0, 3.8, 1, 3.8, 2.7, 2.2, 2.7]] },
  H: { w: 4, s: [[0, 6, 0, 0], [4, 6, 4, 0], [0, 3.1, 4, 3.1]] },
  I: { w: 0.6, s: [[0.3, 6, 0.3, 0]] },
  J: { w: 3.2, s: [[3, 6, 3, 1.4, 2, 0, 0.9, 0.3, 0.2, 1.6]] },
  K: { w: 3.8, s: [[0, 6, 0, 0], [3.8, 6, 0, 2.5], [1.4, 3.6, 3.8, 0]] },
  L: { w: 3.3, s: [[0, 6, 0, 0, 3.3, 0]] },
  M: { w: 4.6, s: [[0, 0, 0, 6, 2.3, 2.2, 4.6, 6, 4.6, 0]] },
  N: { w: 4, s: [[0, 0, 0, 6, 4, 0, 4, 6]] },
  O: { w: 4, s: [[2, 6, 0.6, 5.2, 0, 3, 0.6, 0.8, 2, 0, 3.4, 0.8, 4, 3, 3.4, 5.2, 2.1, 6.1]] },
  P: { w: 3.7, s: [[0, 0, 0, 6, 2.7, 6, 3.7, 4.7, 2.7, 3, 0, 3]] },
  Q: { w: 4, s: [[2, 6, 0.6, 5.2, 0, 3, 0.6, 0.8, 2, 0, 3.4, 0.8, 4, 3, 3.4, 5.2, 2, 6], [2.5, 1.5, 4.1, -0.4]] },
  R: { w: 3.8, s: [[0, 0, 0, 6, 2.7, 6, 3.7, 4.7, 2.7, 3, 0, 3], [1.9, 3, 3.8, 0]] },
  S: { w: 3.6, s: [[3.5, 5.1, 2.2, 6, 0.7, 5.4, 0.4, 4, 1.9, 3.1, 3.4, 2.2, 3.5, 0.9, 2, 0, 0.2, 0.9]] },
  T: { w: 4, s: [[0, 6, 4, 6], [2, 6, 2, 0]] },
  U: { w: 4, s: [[0, 6, 0, 1.5, 1, 0.2, 2, 0, 3, 0.2, 4, 1.5, 4, 6]] },
  V: { w: 4, s: [[0, 6, 2, 0, 4, 6]] },
  W: { w: 5, s: [[0, 6, 1.2, 0, 2.5, 3.8, 3.8, 0, 5, 6]] },
  X: { w: 3.8, s: [[0, 6, 3.8, 0], [3.8, 6, 0, 0]] },
  Y: { w: 4, s: [[0, 6, 2, 3, 4, 6], [2, 3, 2, 0]] },
  Z: { w: 3.8, s: [[0, 6, 3.8, 6, 0, 0, 3.8, 0]] },
  '0': { w: 3.4, s: [[1.7, 6, 0.4, 5, 0, 3, 0.4, 1, 1.7, 0, 3, 1, 3.4, 3, 3, 5, 1.7, 6]] },
  '1': { w: 2.2, s: [[0.3, 4.6, 1.6, 6, 1.6, 0]] },
  '2': { w: 3.6, s: [[0.3, 4.8, 1.8, 6, 3.4, 5, 3.1, 3.4, 0.1, 0, 3.6, 0]] },
  '3': { w: 3.6, s: [[0.4, 5.2, 1.8, 6, 3.3, 5.2, 3.1, 3.8, 1.5, 3.1, 3.3, 2.4, 3.5, 1, 2, 0, 0.3, 0.9]] },
  '4': { w: 3.8, s: [[2.9, 0, 2.9, 6, 0, 1.9, 3.8, 1.9]] },
  '.': { w: 0.8, s: [[0.3, 0, 0.5, 0.35]] },
  ',': { w: 0.8, s: [[0.5, 0.4, 0.1, -0.9]] },
  "'": { w: 0.7, s: [[0.5, 6, 0.2, 4.7]] },
  '-': { w: 2.6, s: [[0.2, 3, 2.4, 3]] },
  '!': { w: 0.7, s: [[0.35, 6, 0.35, 1.7], [0.3, 0, 0.4, 0.3]] },
  '/': { w: 3, s: [[0, 0, 3, 6]] },
  '→': { w: 4.6, s: [[0, 3, 4.4, 3], [2.7, 4.6, 4.5, 3, 2.7, 1.4]] },
  '←': { w: 4.6, s: [[4.6, 3, 0.2, 3], [1.9, 4.6, 0.1, 3, 1.9, 1.4]] },
};
const GAP = 1.05, SPACE = 2.7;

export type ScrawlStyle = 'marker' | 'pen' | 'scratch' | 'paint';
export interface ScrawlOpts {
  style: ScrawlStyle;
  /** Quad width / height. */
  aspect: number;
  /** Canvas width in pixels (default 1024). */
  px?: number;
  color?: string;
  seed?: number;
  /** Extra strokes in canvas pixels, painted like the text (tally marks, underlines, strike-throughs). */
  extra?: (W: number, H: number, R: Rng, add: (pts: number[], width?: number) => void) => void;
  /** Fraction of the height left free at the top for `extra`. */
  top?: number;
  /** Paint a background first (a tag, a sheet of paper). */
  bg?: (g: CanvasRenderingContext2D, W: number, H: number) => void;
}

interface Stroke { p: number[]; w: number }

function layout(lines: string[], W: number, H: number, top: number, R: Rng, wobble: number): { strokes: Stroke[]; size: number } {
  const strokes: Stroke[] = [];
  const mx = W * 0.05, y0 = H * (0.06 + top), usable = H * (0.9 - top);
  const lh = usable / lines.length;
  let size = lh * 0.7;
  // one letter size for all lines: fit the longest
  for (const line of lines) {
    let units = 0;
    for (const ch of line) units += ch === ' ' ? SPACE : (G[ch]?.w ?? 3) + GAP;
    size = Math.min(size, ((W - 2 * mx) / units) * 6);
  }
  const s = size / 6;
  lines.forEach((line, li) => {
    let units = 0;
    for (const ch of line) units += ch === ' ' ? SPACE : (G[ch]?.w ?? 3) + GAP;
    const slack = W - 2 * mx - units * s;
    let x = mx + slack * R.range(0, 0.5);
    const slope = R.range(-0.035, 0.012) * wobble; // lines sag to the right
    const base = y0 + lh * li + lh * 0.5 + size * 0.5;
    for (const ch of line) {
      if (ch === ' ') { x += SPACE * s * R.range(0.8, 1.25); continue; }
      const g = G[ch];
      if (!g) { x += 3 * s; continue; }
      const rot = R.range(-0.09, 0.09) * wobble, sc = s * (1 + R.range(-0.09, 0.09) * wobble), lean = R.range(-0.12, 0.05) * wobble;
      const ox = x, oy = base + (x - mx) * slope + R.range(-0.05, 0.05) * size * wobble;
      const c = Math.cos(rot), sn = Math.sin(rot);
      for (const st of g.s) {
        const p: number[] = [];
        for (let i = 0; i < st.length; i += 2) {
          const gx = (st[i] + st[i + 1] * lean + R.range(-0.16, 0.16) * wobble) * sc, gy = (st[i + 1] + R.range(-0.16, 0.16) * wobble) * sc;
          p.push(ox + gx * c + gy * sn, oy - gy * c + gx * sn);
        }
        strokes.push({ p, w: 1 });
      }
      x += (g.w + GAP * R.range(0.7, 1.3)) * sc;
    }
  });
  return { strokes, size };
}

function trace(g: CanvasRenderingContext2D, p: number[], smooth: boolean, dx = 0, dy = 0) {
  g.beginPath();
  g.moveTo(p[0] + dx, p[1] + dy);
  if (!smooth || p.length <= 4) for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] + dx, p[i + 1] + dy);
  else {
    for (let i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i] + dx, p[i + 1] + dy, (p[i] + p[i + 2]) / 2 + dx, (p[i + 1] + p[i + 3]) / 2 + dy);
    g.lineTo(p[p.length - 2] + dx, p[p.length - 1] + dy);
  }
  g.stroke();
}

export function scrawlTexture(lines: string[], o: ScrawlOpts): THREE.CanvasTexture {
  const W = o.px ?? 1024, H = Math.max(16, Math.round(W / o.aspect / 4) * 4);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const R = rng((o.seed ?? 1) * 9973 + lines.join('').length * 131);
  o.bg?.(g, W, H);
  const wobble = o.style === 'scratch' ? 1.5 : o.style === 'paint' ? 1.1 : 1;
  const { strokes, size } = layout(lines, W, H, o.top ?? 0, R, wobble);
  o.extra?.(W, H, R, (pts, width = 1) => strokes.push({ p: pts, w: width }));
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (o.style === 'marker' || o.style === 'pen') {
    const lw = size * (o.style === 'marker' ? 0.17 : 0.055);
    g.strokeStyle = o.color ?? '#14161b';
    for (const st of strokes) {
      g.globalAlpha = R.range(0.9, 1); g.lineWidth = lw * st.w * R.range(0.82, 1.15);
      trace(g, st.p, true);
      // the felt tip leaves a paler second edge where it skipped
      g.globalAlpha = 0.35; g.lineWidth = lw * 0.4;
      trace(g, st.p, true, R.range(-1, 1) * lw * 0.35, R.range(-1, 1) * lw * 0.35);
    }
  } else if (o.style === 'scratch') {
    const k = W / 1024;
    g.lineJoin = 'miter';
    for (const st of strokes) {
      // chipped paint edge, then several passes of the nail / blade down to bright metal
      g.globalAlpha = 0.55; g.strokeStyle = '#06080a'; g.lineWidth = 7 * k * st.w;
      trace(g, st.p, false);
      const passes = 3 + R.int(0, 2);
      for (let i = 0; i < passes; i++) {
        g.globalAlpha = R.range(0.5, 0.95); g.strokeStyle = o.color ?? (R.chance(0.3) ? '#8e979c' : '#cfd6da'); g.lineWidth = R.range(1.2, 2.8) * k * st.w;
        trace(g, st.p, false, R.range(-2.4, 2.4) * k, R.range(-2.4, 2.4) * k);
      }
    }
  } else {
    const lw = size * 0.17;
    const col = o.color ?? '#c8c0b0';
    for (const st of strokes) {
      g.globalAlpha = 0.96; g.strokeStyle = col; g.lineWidth = lw * st.w * R.range(0.85, 1.2);
      trace(g, st.p, true);
      // bristle streaks: the brush runs dry along the stroke
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 3; i++) { g.globalAlpha = R.range(0.15, 0.5); g.lineWidth = lw * 0.07; trace(g, st.p, true, R.range(-1, 1) * lw * 0.4, R.range(-1, 1) * lw * 0.4); }
      g.globalCompositeOperation = 'source-over';
      // runs
      if (R.chance(0.3)) {
        let low = 1;
        for (let i = 3; i < st.p.length; i += 2) if (st.p[i] > st.p[low]) low = i;
        const x = st.p[low - 1], y = st.p[low], len = size * R.range(0.25, 1.3);
        g.globalAlpha = 0.9; g.lineWidth = lw * R.range(0.18, 0.3);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + R.range(-2, 2), Math.min(H - 4, y + len)); g.stroke();
        g.beginPath(); g.fillStyle = col; g.arc(x, Math.min(H - 4, y + len), lw * 0.2, 0, 6.3); g.fill();
      }
    }
  }
  // wear: flecks knocked out of the paint / ink
  if (o.style !== 'scratch') {
    g.globalCompositeOperation = 'destination-out';
    const n = o.style === 'paint' ? 900 : 260;
    for (let i = 0; i < n; i++) {
      g.globalAlpha = R.range(0.15, 0.7);
      g.beginPath(); g.arc(R() * W, R() * H, R.range(0.6, o.style === 'paint' ? 5 : 2.2) * (W / 1024), 0, 6.3); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = `scrawl:${lines[0] ?? ''}`;
  return t;
}

/** Decal-like material carrying a piece of hand lettering (use on a unit-UV quad just off the surface). */
export function scrawlMaterial(lines: string[], o: ScrawlOpts): THREE.MeshStandardMaterial {
  const scratch = o.style === 'scratch';
  const m = new THREE.MeshStandardMaterial({
    map: scrawlTexture(lines, o), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    roughness: scratch ? 0.32 : o.style === 'paint' ? 0.6 : 0.85, metalness: scratch ? 0.85 : 0,
    side: o.bg ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = `scrawl_${o.style}`;
  return m;
}

/** "31" in paint over a field of tally marks, every group struck through. */
export function tallyMaterial(aspect: number): THREE.MeshStandardMaterial {
  return scrawlMaterial(['31'], {
    style: 'paint', aspect, seed: 31, color: '#bdb6a6', top: 0.42,
    extra: (W, H, R, add) => {
      // 31 marks: six bundles of five and one left over, in two ragged rows
      const mh = H * 0.15;
      let n = 0;
      for (let row = 0; row < 2; row++) {
        let x = W * 0.07 + R.range(0, W * 0.03);
        const y = H * (0.07 + row * 0.2);
        const groups = row === 0 ? 4 : 3;
        for (let k = 0; k < groups && n < 31; k++) {
          const x0 = x;
          const marks = Math.min(4, 31 - n);
          for (let i = 0; i < marks; i++) { add([x + R.range(-3, 3), y + R.range(-4, 4), x + R.range(-5, 5), y + mh + R.range(-5, 5)], 0.42); x += W * 0.028; n++; }
          if (n < 31 && marks === 4) { add([x0 - W * 0.02, y + mh * R.range(0.55, 0.8), x + W * 0.005, y + mh * R.range(0.15, 0.4)], 0.42); n++; }
          x += W * 0.05;
        }
      }
      // ...and all of it crossed out, twice
      add([W * 0.04, H * 0.2, W * 0.5, H * 0.24, W * 0.93, H * 0.19], 0.55);
      add([W * 0.05, H * 0.34, W * 0.45, H * 0.3, W * 0.9, H * 0.37], 0.5);
    },
  });
}
