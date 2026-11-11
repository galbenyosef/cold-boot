/**
 * Procedural FX textures, generated once at load.
 *
 * Puff atlas (2x2 tiles): R = billowy density (radially faded), G/B = density gradient (normal-ish, 0.5
 * biased) for fake self-shadowing, A = high-frequency turbulence used to break up fire.
 */
import * as THREE from 'three';

function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (ix: number, iy: number, dx: number, dy: number) => {
      const h = perm[perm[ix] + iy];
      return gx[h] * dx + gy[h] * dy;
    };
    const n00 = g(X, Y, xf, yf), n10 = g(X + 1, Y, xf - 1, yf);
    const n01 = g(X, Y + 1, xf, yf - 1), n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
    const u = fade(xf), v = fade(yf);
    return (n00 + (n10 - n00) * u) + ((n01 + (n11 - n01) * u) - (n00 + (n10 - n00) * u)) * v; // ~[-0.7,0.7]
  };
}

export function createPuffAtlas(tile = 256): THREE.DataTexture {
  const size = tile * 2;
  const data = new Uint8Array(size * size * 4);
  const dens = new Float32Array(tile * tile);
  for (let t = 0; t < 4; t++) {
    const n1 = makeNoise(17 + t * 131);
    const n2 = makeNoise(907 + t * 53);
    const ox = (t % 2) * tile, oy = Math.floor(t / 2) * tile;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const u = (x + 0.5) / tile * 2 - 1, v = (y + 0.5) / tile * 2 - 1;
        const r = Math.sqrt(u * u + v * v);
        // Domain-warped fbm → cauliflower billows.
        let f = 0, amp = 0.5, fr = 1.6;
        const wx = n2(u * 1.3 + 5.1, v * 1.3) * 0.6, wy = n2(u * 1.3, v * 1.3 + 9.7) * 0.6;
        for (let o = 0; o < 5; o++) {
          f += amp * (1 - Math.abs(n1((u + wx) * fr + o * 3.1, (v + wy) * fr - o * 1.7)) * 1.4);
          amp *= 0.5; fr *= 2.03;
        }
        // f roughly 0..1, billowy
        const edge = r + (0.5 - f) * 0.55;
        let d = 1 - smooth(0.15, 0.95, edge);
        d *= 0.55 + 0.6 * f;
        d *= 1 - smooth(0.82, 1.0, r);
        dens[y * tile + x] = Math.max(0, Math.min(1, d));
      }
    }
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const s = (xx: number, yy: number) => dens[Math.min(tile - 1, Math.max(0, yy)) * tile + Math.min(tile - 1, Math.max(0, xx))];
        const k = 3;
        const gxv = (s(x + k, y) - s(x - k, y)) * 2.0;
        const gyv = (s(x, y + k) - s(x, y - k)) * 2.0;
        const u = (x + 0.5) / tile * 2 - 1, v = (y + 0.5) / tile * 2 - 1;
        let turb = 0, amp = 0.5, fr = 5;
        for (let o = 0; o < 3; o++) { turb += amp * n2(u * fr + 40, v * fr - 13); amp *= 0.5; fr *= 2.1; }
        const i = ((oy + y) * size + (ox + x)) * 4;
        data[i] = Math.round(dens[y * tile + x] * 255);
        data[i + 1] = Math.round(Math.max(0, Math.min(1, gxv * 0.5 + 0.5)) * 255);
        data[i + 2] = Math.round(Math.max(0, Math.min(1, gyv * 0.5 + 0.5)) * 255);
        data[i + 3] = Math.round(Math.max(0, Math.min(1, turb + 0.5)) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
