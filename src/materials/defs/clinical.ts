/**
 * Stage 3b clean side + navy level (docs/plans/stage-3b.md §8.7, §2.6). Same contract as the other bodies:
 * `heightFn` (height + masks) and `surf`, tileable over the tile, authored in metres (`uv * uTile`).
 *
 * Clean side: cold, exact and wiped — white HPL panels with silicone seams, poured epoxy, a gel-seal ceiling grid
 * with HEPA faces, #4 stainless (the shared METAL program), frost, spunbond suits. No grime: wear is a wipe arc, a
 * heel mark, a hairline scratch. Navy level: many coats of haze grey with chips through to the older coats, grit deck.
 *
 * Albedos are kept ≤ ~0.85 sRGB so the whites hold under a cold 6500 K lamp at ACES exposure 1 (checked in the
 * gallery, dev/clinical.ts), and no stacked darkening (the 3a `fabric_warm` lesson): AO and mottle only.
 */

/** wall_clean: 2.4 m tile = two 1.2 × 2.4 m HPL panels, 9 mm joints filled with a rounded silicone bead. */
export const WALL_CLEAN = /* glsl */ `
float seamDist(vec2 m) {
  float dx = abs(fract(m.x / 1.2 + 0.5) - 0.5) * 1.2;
  float dy = abs(fract(m.y / 2.4 + 0.5) - 0.5) * 2.4;
  return min(dx, dy);
}
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float d = seamDist(m);
  float gap = 1.0 - smoothstep(0.0038, 0.0052, d);
  float bead = dome(d, 0.0045);
  float h = 0.62;
  // panel arris: a tiny radius before the joint
  h -= 0.06 * (1.0 - smoothstep(0.0045, 0.008, d));
  h = mix(h, 0.36 + 0.14 * bead, gap);
  // HPL matte finish: a very fine stipple, and the board is not perfectly flat
  float N = floor(uTile * 200.0);
  h += 0.006 * gnoise(uv * N, vec2(N), 2.0);
  h += 0.012 * fbm(uv, vec2(4.0), 3, 0.5, 3.0);
  float pid = h1(ivec2(int(floor(m.x / 1.2)), int(floor(m.y / 2.4))), 5.0);
  float scr = scratches(uv, 8.0, 0.0, 3.0, 0.1, 0.4, 0.8, 0.22, 7.0);
  h -= 0.02 * scr;
  return vec4(h, gap, pid, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float gap = H.g, pid = H.b, scr = H.a;
  float mott = fbm01(uv, vec2(3.0), 4, 0.5, 11.0);
  // each board a hair different (different sheets from the same batch)
  vec3 c = uBase * (0.985 + 0.025 * (pid - 0.5) + 0.03 * (mott - 0.5));
  // wipe arcs: the cleaning cloth leaves slightly glossier swirls
  float wipe = smoothstep(0.55, 0.85, streakNoise(uv + vec2(0.0, 0.15 * fbm(uv, vec2(3.0), 3, 0.5, 15.0)), 8.0, 3.0, 13.0));
  rough = 0.42 + 0.06 * (mott - 0.5) - 0.06 * wipe;
  // silicone bead: pale grey, glossier
  c = mix(c, C(0xb8bfc3) * (0.95 + 0.06 * mott), gap);
  rough = mix(rough, 0.28, gap);
  // rare trolley / boot scuffs, only low on the wall
  float yIn = fract(m.y / 2.4) * 2.4;
  float low = 1.0 - smoothstep(0.12, 0.5, yIn);
  float sc = smoothstep(0.74, 0.9, fbm01(uv, vec2(10.0, 30.0), 5, 0.55, 14.0)) * low;
  c = mix(c, c * vec3(0.84, 0.86, 0.88), sc * uGrime);
  c = mix(c, c * 0.95, smoothstep(0.1, 0.5, scr) * 0.3);
  rough = mix(rough, 0.5, smoothstep(0.1, 0.5, scr) * 0.4);
  albedo = c * mix(0.86, 1.0, D.x);
  metal = 0.0;
}
`;

/** floor_epoxy: seamless self-levelled epoxy, gloss; pinholes, sparse flecks, micro-scratch swirls, duller traffic. */
export const FLOOR_EPOXY = /* glsl */ `
vec4 heightFn(vec2 uv) {
  float h = 0.5 + 0.06 * fbm(uv, vec2(2.0), 4, 0.5, 1.0);
  float N = floor(uTile * 120.0);
  h += 0.005 * gnoise(uv * N, vec2(N), 2.0);
  float NP = floor(uTile * 90.0);
  vec3 p = worley(uv * NP, vec2(NP), 3.0);
  float pin = smoothstep(0.12, 0.04, p.x) * step(0.94, p.z);
  h -= 0.12 * pin;
  float s1 = scratches(uv, 12.0, 0.4, 3.2, 0.2, 1.2, 0.8, 0.5, 4.0);
  float s2 = scratches(uv, 30.0, 1.2, 3.2, 0.1, 0.6, 0.6, 0.4, 5.0);
  float scr = max(s1, s2 * 0.7);
  h -= 0.015 * scr;
  return vec4(h, pin, scr, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float n1 = fbm01(uv, vec2(2.0), 5, 0.55, 11.0);
  float n2 = fbm01(uv, vec2(9.0), 4, 0.5, 12.0);
  vec3 c = uBase * (0.96 + 0.05 * n1 + 0.02 * (n2 - 0.5));
  // sparse grey flecks in the resin
  float NF = floor(uTile * 160.0);
  vec3 f = worley(uv * NF, vec2(NF), 6.0);
  float fleck = smoothstep(0.25, 0.1, f.x) * step(0.82, f.z);
  c = mix(c, c * mix(0.62, 1.06, fract(f.z * 13.0)), fleck * 0.55);
  // traffic dulls the gloss in broad soft patches; scratches dull it locally
  float traffic = smoothstep(0.45, 0.85, fbm01(uv, vec2(3.0), 5, 0.55, 13.0));
  rough = 0.09 + 0.06 * n2 + 0.14 * traffic;
  float sc = smoothstep(0.1, 0.6, H.b);
  rough = mix(rough, 0.32, sc * 0.6);
  c *= 1.0 - H.g * 0.5;
  // black rubber heel marks: rare
  float heel = smoothstep(0.84, 0.96, fbm01(uv, vec2(8.0, 20.0), 5, 0.6, 14.0));
  c = mix(c, C(0x55595b), heel * 0.3);
  albedo = c * mix(0.9, 1.0, D.x);
  metal = 0.0;
}
`;

/**
 * ceiling_clean: 2.4 m tile of 0.6 m cells in a 40 mm white gel-seal grid; a quarter of the cells are HEPA faces
 * (perforated, with a solid centre deflector), the rest flush filled panels.
 */
export const CEILING_CLEAN = /* glsl */ `
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  vec2 cell = floor(m / 0.6); vec2 q = m - (cell + 0.5) * 0.6;
  float d = sdBox(q, vec2(0.28), 0.003);
  float bar = smoothstep(-0.0012, 0.0012, d);
  float seal = (1.0 - smoothstep(0.0, 0.0022, abs(d + 0.0025))) * (1.0 - bar);
  float hepa = mod(cell.x + cell.y * 2.0, 4.0) < 0.5 ? 1.0 : 0.0;
  float h = 0.42;
  float hole = 0.0;
  if (hepa > 0.5) {
    float di = sdBox(q, vec2(0.25), 0.01);
    float inner = step(di, 0.0);
    float centre = step(sdBox(q, vec2(0.075), 0.004), 0.0);
    vec2 hp = fract(uv * 160.0) - 0.5;
    hole = (1.0 - smoothstep(0.2, 0.3, length(hp))) * inner * (1.0 - centre);
    h += 0.04 * roundBevel(di, 0.005) * (1.0 - inner) - 0.22 * hole + 0.05 * centre;
  }
  h = mix(h, 0.58 + 0.04 * dome(max(0.0, 0.02 - abs(d)), 0.02), bar);
  h -= 0.14 * seal;
  h += 0.004 * fbm(uv, vec2(8.0), 3, 0.5, 4.0);
  return vec4(h, bar, hepa, max(seal, hole));
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float bar = H.g, hepa = H.b;
  float mott = fbm01(uv, vec2(4.0), 4, 0.5, 11.0);
  vec3 c = uBase * (0.97 + 0.05 * mott);
  rough = 0.6 + 0.08 * mott;
  // HEPA face: powder-coated, a touch brighter and smoother; holes dark (the filter behind)
  c = mix(c, uBase * 1.03, hepa * (1.0 - bar));
  rough = mix(rough, 0.45, hepa * (1.0 - bar));
  float dark = H.a * (1.0 - bar);
  c = mix(c, C(0x2c3134), dark * 0.85);
  // grid: white powder-coat aluminium, satin
  c = mix(c, C(0xd2d7da) * (0.96 + 0.06 * mott), bar);
  rough = mix(rough, 0.38, bar);
  // faint grey dust ring that settles round each HEPA face (the only dirt up here)
  albedo = c * mix(0.82, 1.0, D.x);
  metal = 0.0;
}
`;

/** frost: crust 0xe6f2ff (uCol) over cold steel (uCol2): granular base, hoar needles, glinting facets. */
export const FROST = /* glsl */ `
uniform vec3 uCol; uniform vec3 uCol2;
vec4 heightFn(vec2 uv) {
  float N1 = floor(uTile * 45.0), N2 = floor(uTile * 160.0);
  vec3 w1 = worley(uv * N1, vec2(N1), 1.0);
  vec3 w2 = worley(uv * N2, vec2(N2), 2.0);
  // crust thickness: drifts and ridges, thin only in a few hollows
  float thick = fbm01(uv, vec2(6.0), 5, 0.55, 3.0);
  float h = 0.2 + 0.3 * thick + 0.2 * (1.0 - w1.x) + 0.1 * (1.0 - w2.x);
  // hoar needles standing out of the crust
  float nd1 = scratches(uv, floor(uTile * 26.0), 0.0, 6.28, 0.3, 1.0, 1.8, 0.85, 5.0);
  float nd2 = scratches(uv, floor(uTile * 60.0), 0.0, 6.28, 0.2, 0.9, 1.2, 0.9, 6.0);
  float needles = max(nd1, nd2 * 0.85);
  h += 0.22 * needles;
  return vec4(h, thick, needles, w2.z);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float thick = H.g, nd = H.b;
  // white crust; the steel shows (greyed) only in the thinnest hollows; shade in the pits is blue
  vec3 c = uCol * (0.76 + 0.1 * thick);
  c = mix(c, uCol2 * 1.15, smoothstep(0.22, 0.05, thick) * 0.6);
  c = mix(c, uCol, nd * 0.7);
  c = mix(c * vec3(0.8, 0.88, 1.0), c, D.x);
  float fac = step(0.86, H.a);
  rough = 0.62 + 0.1 * thick;
  rough = mix(rough, 0.08, fac * 0.85);
  rough = mix(rough, 0.3, nd * 0.5);
  albedo = c * mix(0.8, 1.0, D.x);
  metal = 0.0;
}
`;

/** tyvek: spunbond polyethylene — cloudy fibre formation, a random fibre web, crinkle creases. */
export const TYVEK = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float cr = ridged(uv, vec2(4.0), 4, 1.0);
  float cr2 = ridged(uv, vec2(11.0), 3, 2.0);
  float h = 0.5 + 0.34 * cr + 0.12 * cr2;
  float N = floor(uTile * 90.0);
  float fib = scratches(uv, N, 0.0, 6.28, 0.6, 1.6, 0.9, 0.9, 3.0);
  h += 0.035 * fib;
  float N2 = floor(uTile * 400.0);
  h += 0.015 * gnoise(uv * N2, vec2(N2), 4.0);
  return vec4(h, cr, fib, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float NB = floor(uTile * 30.0);
  float blot = fbm01(uv, vec2(NB), 4, 0.6, 7.0);
  vec3 c = uCol * (0.94 + 0.08 * blot);
  c = mix(c, uCol * 1.02, H.b * 0.3);
  rough = 0.64 + 0.1 * blot - 0.1 * H.b;
  albedo = c * mix(0.84, 1.0, D.x);
  metal = 0.0;
}
`;

/**
 * navy_grey: haze grey (uCol) in many coats; chips go through to an older, darker coat (uCol2), deeper ones to red
 * oxide primer and a little bare steel with a rust tint; old chips painted over show as soft craters; touch-up patches.
 */
export const NAVY_GREY = /* glsl */ `
uniform vec3 uCol; uniform vec3 uCol2; uniform float uWear;
vec4 heightFn(vec2 uv) {
  float N = floor(uTile * 120.0);
  vec3 w = worley(uv * N, vec2(N), 1.0);
  float peel = smoothstep(0.8, 0.2, w.x);
  float h = 0.5 + 0.02 * peel + 0.04 * fbm(uv, vec2(3.0), 4, 0.5, 2.0);
  float old = smoothstep(0.63, 0.68, fbm01(uv, vec2(7.0), 5, 0.6, 3.0));
  h -= 0.05 * old;
  vec2 chip = chipMask(uv, 8.0, 0.0, -0.2 + uWear * 0.12, 4.0);
  h -= 0.05 * chip.x + 0.04 * chip.y;
  float scr = scratches(uv, 10.0, 0.2, 2.5, 0.2, 1.0, 1.0, 0.35, 5.0);
  h -= 0.02 * scr;
  return vec4(h, chip.x, chip.y, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float mott = fbm01(uv, vec2(4.0), 5, 0.5, 11.0);
  vec3 coat = uCol * (0.94 + 0.1 * mott);
  float tp = smoothstep(0.68, 0.78, fbm01(uv, vec2(3.0), 3, 0.5, 12.0));
  coat = mix(coat, uCol * vec3(1.03, 1.035, 1.04), tp * 0.5);
  vec3 under = uCol2 * (0.9 + 0.15 * mott);
  float rn = fbm01(uv, vec2(20.0), 3, 0.5, 13.0);
  vec3 deep = mix(C(0x7a3a28), C(0x55595c), smoothstep(0.55, 0.7, rn));
  vec3 c = mix(coat, under, H.g);
  c = mix(c, deep, H.b);
  rough = mix(0.52 + 0.1 * mott, 0.6, H.g);
  rough = mix(rough, 0.72, H.b);
  metal = H.b * smoothstep(0.55, 0.7, rn) * 0.6;
  float sc = smoothstep(0.1, 0.6, H.a);
  c = mix(c, under * 1.15, sc * 0.6);
  float rustN = fbm01(uv, vec2(16.0), 4, 0.55, 14.0);
  c = mix(c, mix(C(0x5a2c18), C(0x8a4a24), rustN), H.b * smoothstep(0.5, 0.8, rustN) * 0.6);
  float g = grimeAmount(uv, D, 0.3, 19.0);
  c = mix(c, C(0x2a2c2c), g * 0.4);
  albedo = c * mix(0.82, 1.0, D.x);
}
`;

/** deck_nonslip: dark deck paint with grit aggregate; grit tips worn pale and smooth in the traffic lanes. */
export const DECK_NONSLIP = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float N = floor(uTile * 220.0);
  vec3 w = worley(uv * N, vec2(N), 1.0);
  float grit = dome(w.x, 0.6) * (0.55 + 0.45 * w.z);
  float wear = smoothstep(0.45, 0.85, fbm01(uv, vec2(3.0), 5, 0.55, 2.0));
  float h = 0.4 + 0.35 * grit * (1.0 - 0.5 * wear) + 0.04 * fbm(uv, vec2(4.0), 3, 0.5, 3.0);
  float N2 = floor(uTile * 600.0);
  h += 0.04 * gnoise(uv * N2, vec2(N2), 4.0);
  float scr = scratches(uv, 8.0, 0.0, 3.2, 0.2, 1.0, 1.4, 0.3, 5.0);
  h -= 0.05 * scr;
  return vec4(h, grit, wear, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec3 c = uCol * (0.92 + 0.12 * fbm01(uv, vec2(5.0), 4, 0.5, 11.0));
  float tip = smoothstep(0.5, 0.9, H.g) * (0.4 + 0.6 * H.b);
  c = mix(c, c * 1.4 + 0.03, tip * 0.5);
  rough = mix(0.86, 0.6, H.b * 0.6);
  rough = mix(rough, 0.45, tip * 0.4);
  float sc = smoothstep(0.1, 0.6, H.a);
  c = mix(c, c * 1.25, sc * 0.4);
  float g = grimeAmount(uv, D, 0.45, 19.0);
  c = mix(c, C(0x1c1d1d), g * 0.45);
  albedo = c * mix(0.78, 1.0, D.x);
  metal = 0.0;
}
`;
