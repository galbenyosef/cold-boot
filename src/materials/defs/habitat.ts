/**
 * Stage 3a habitat surfaces (docs/plans/stage-3a.md §8.6): warm, ordinary, lived-in — wood, cloth, carpet, plaster,
 * stone, tile, lino, garden, water, clean glass. Same contract as the industrial bodies: `heightFn` (height + masks)
 * and `surf` (albedo / roughness / metalness / alpha), tileable over the tile, authored in metres (`uv * uTile`).
 *
 * Unlike levels 1–2 nothing here is dirty: wear is light (satin rubbed smooth, a heel mark, a coffee ring), never grime.
 */

/**
 * Wood veneer (wood_veneer = crown-cut oak, wood_dark = walnut). GRAIN RUNS ALONG V (vertical on a door / wall
 * panel); the surface is made of veneer leaves `uLeaf` metres wide, each with its own figure, butt-jointed.
 * uColA earlywood, uColB latewood, uRing rings per metre across the grain, uWarp meander, uRay oak ray flecks,
 * uPore open-pore amount, uRough (satin min, max).
 */
export const WOOD = /* glsl */ `
uniform vec3 uColA; uniform vec3 uColB; uniform float uLeaf; uniform float uRing; uniform float uWarp; uniform float uRay;
uniform float uPore; uniform vec2 uRough;
// x: (latewood 0..1, pore 0..1, ray 0..1, seam 0..1); also returns leaf hash in lh
vec4 wood(vec2 uv, out vec3 lh) {
  float nL = max(1.0, floor(uTile / uLeaf + 0.5));
  float lx = uv.x * nL; float li = floor(lx); float lf = lx - li;
  lh = h3(ivec2(int(li), 17), 3.0);
  float lw = uTile / nL;
  float sL = 10.0 + li * 7.0;
  float ky = floor(uTile * 1.5 + 0.5);
  float x = lf * lw;                                   // metres across this leaf
  // the grain meanders slowly along the length (barely across the leaf), plus a slight unevenness
  float wv = fbm(uv, vec2(nL, ky), 2, 0.5, sL) * uWarp;
  float wv2 = fbm(uv, vec2(nL * 2.0, ky * 6.0), 2, 0.5, sL + 1.0) * 0.12 * uWarp;
  // crown cut: rings bow as a parabola across the leaf; the bow's depth wanders along the length, which draws
  // the cathedral arches
  float xc = lw * (0.35 + 0.3 * lh.z);
  float bow = fbm01(uv, vec2(nL, ky * 2.0), 2, 0.5, sL + 4.0);
  float g = x * uRing + wv * 2.2 + wv2 + lh.x * 13.0 + (x - xc) * (x - xc) * uRing * (4.0 + 14.0 * bow) * uRay;
  float ring = fract(g);
  float late = smoothstep(0.58, 0.84, ring) * (1.0 - smoothstep(0.93, 1.0, ring));
  // open pores: fine short dark dashes, mostly in the earlywood
  float py = floor(uTile * 70.0);
  float pn = vnoise(vec2(x * 1100.0 + wv * 30.0, uv.y * py), vec2(8192.0, py), sL + 5.0);
  float pore = smoothstep(0.72, 0.9, pn) * (1.0 - late * 0.7) * uPore;
  // medullary ray flecks (quarter-cut oak): tiny lenses across the grain, sparse
  float ry = floor(uTile * 160.0);
  vec3 w = worley(vec2(x * 70.0, uv.y * ry), vec2(8192.0, ry), sL + 7.0);
  float ray = smoothstep(0.22, 0.06, w.x) * step(0.86, w.z) * uRay;
  // butt joint between leaves
  float seam = 1.0 - smoothstep(0.0, 1.6 * nL / uRes.x, min(lf, 1.0 - lf));
  return vec4(late, pore, ray, seam);
}
float woodFibre(vec2 uv) {
  float nL = max(1.0, floor(uTile / uLeaf + 0.5)), ky = floor(uTile * 1.5 + 0.5);
  float lx = uv.x * nL, li = floor(lx);
  return vnoise(vec2((lx - li) * uTile / nL * 1400.0, uv.y * ky * 8.0), vec2(8192.0, ky * 8.0), 12.0 + li * 7.0);
}
vec4 heightFn(vec2 uv) {
  vec3 lh; vec4 W = wood(uv, lh);
  float h = 0.5 + 0.1 * W.x - 0.4 * W.y + 0.05 * W.z - 0.35 * W.w + 0.04 * woodFibre(uv);
  h += 0.04 * fbm(uv, vec2(3.0), 3, 0.5, 30.0);
  // light use: a few fine scuffs across the grain
  float scr = scratches(uv, 6.0, 0.2, 0.6, 0.1, 0.6, 0.7, 0.18, 31.0);
  h -= 0.08 * scr;
  return vec4(h, W.y, W.z, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec3 lh; vec4 W = wood(uv, lh);
  vec3 c = mix(uColA, uColB, W.x * 0.8);
  c *= 0.95 + 0.1 * woodFibre(uv);
  // each leaf a slightly different tone (the flitch varies)
  c *= 0.95 + 0.1 * lh.y;
  c = mix(c, c * vec3(1.03, 0.99, 0.95), lh.z * 0.5);
  c = mix(c, uColB * 0.7, W.y * 0.4);                        // pores filled with darker stain
  c = mix(c, uColA * 1.1, W.z * 0.4);                        // rays catch the light
  c *= 1.0 - W.w * 0.35;
  c *= 0.93 + 0.12 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  // satin lacquer: smooth, pores dull, a little wear polish
  float mott = fbm01(uv, vec2(4.0), 4, 0.5, 41.0);
  rough = mix(uRough.x, uRough.y, 0.55 * mott + 0.6 * W.y);
  float sc = smoothstep(0.1, 0.6, H.a);
  c = mix(c, c * 1.15 + 0.02, sc * 0.5); rough = mix(rough, uRough.y + 0.15, sc * 0.6);
  albedo = c * mix(0.85, 1.0, D.x);
  metal = 0.0;
}
`;

/** Upholstery twill (fabric_warm): 2/2 twill, two-tone yarn, near-neutral so per-instance colour tints it. */
export const TWILL = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float n = 150.0;                          // threads per 0.25 m tile → 1.7 mm
  vec2 p = uv * n; vec2 c = floor(p); vec2 f = fract(p);
  float k = mod(c.x + c.y, 4.0);
  float warpUp = step(k, 1.5);              // warp floats over two picks, shifted one per pick → 45° ribs
  // a float is continuous over its two cells: round off at its ends only
  float endW = k < 0.5 ? sin(max(f.y, 0.12) * PI * 0.5) : sin(max(1.0 - f.y, 0.12) * PI * 0.5);
  float k2 = mod(c.x + c.y + 2.0, 4.0);
  float endF = k2 < 0.5 ? sin(max(f.x, 0.12) * PI * 0.5) : sin(max(1.0 - f.x, 0.12) * PI * 0.5);
  float warp = pow(sin(f.x * PI), 0.55) * mix(1.0, endW, 0.6);
  float weft = pow(sin(f.y * PI), 0.55) * mix(1.0, endF, 0.6);
  float h = (warpUp > 0.5 ? warp : weft) * 0.8;
  float fib = warpUp > 0.5 ? gnoise(uv * vec2(n * 0.6, n * 5.0), vec2(n * 0.6, n * 5.0), 1.0)
                           : gnoise(uv * vec2(n * 5.0, n * 0.6), vec2(n * 5.0, n * 0.6), 2.0);
  h += 0.07 * fib;
  h += 0.12 * fbm(uv, vec2(2.0), 4, 0.5, 3.0);
  float pill = smoothstep(0.28, 0.08, worley(uv * 40.0, vec2(40.0), 4.0).x) * 0.12;
  h += pill;
  return vec4(h, warpUp, fib, pill);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float n = 150.0;
  vec2 c = floor(uv * n);
  // yarn: each thread its own slub; warp a touch darker than weft (two-tone twill shows its diagonal)
  float yw = h1(ivec2(int(c.x), 1), 5.0), yf = h1(ivec2(1, int(c.y)), 6.0);
  float slub = H.g > 0.5 ? yw : yf;
  vec3 col = uCol * (H.g > 0.5 ? 0.8 : 1.06) * (0.96 + 0.08 * slub);
  col *= 0.95 + 0.08 * fbm01(uv, vec2(4.0), 3, 0.5, 8.0);
  albedo = col * mix(0.55, 1.0, D.x);
  rough = 0.9; metal = 0.0;
}
`;

/**
 * Loop-pile carpet: tufted loops in rows, heathered yarn, one 30 cm band (uColB) with pinlines (uColC) per tile.
 * The band runs along V (lay a runner with V along its length).
 */
export const CARPET = /* glsl */ `
uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC;
vec2 loopN() { return vec2(floor(uTile * 270.0), floor(uTile * 330.0)); }
vec4 heightFn(vec2 uv) {
  vec2 N = loopN();
  vec2 p = uv * N; vec2 c = floor(p); vec2 f = fract(p) - 0.5;
  vec3 r = h3(wrapc(ivec2(c), ivec2(N)), 1.0);
  float d = length(f * vec2(1.15, 0.95) + (r.xy - 0.5) * 0.18);
  float loop = dome(d, 0.56);
  float h = loop * (0.62 + 0.38 * r.z);
  // pile height wanders a little; tufting rows read as faint lines along V
  h += 0.18 * fbm(uv, vec2(5.0), 4, 0.5, 2.0);
  h -= 0.08 * smoothstep(0.42, 0.5, abs(f.x));
  return vec4(h, r.z, loop, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 N = loopN();
  vec2 c = floor(uv * N);
  vec3 r = h3(wrapc(ivec2(c), ivec2(N)), 9.0);
  float mx = (c.x + 0.5) / N.x * uTile;             // metres across, quantised to the loop row
  // band 30 cm wide starting 0.45 m in, pinlines 1.5 cm outside it
  float band = step(0.45, mx) * step(mx, 0.75);
  float pin = step(abs(mx - 0.43), 0.004) + step(abs(mx - 0.77), 0.004);
  vec3 base = mix(uColA, uColB, band);
  base = mix(base, uColC, sat(pin) * 0.7);
  // heather: a loop is one of three yarn shades
  vec3 yarn = base * (r.x < 0.2 ? 1.25 : r.x < 0.38 ? 0.8 : 0.96 + 0.08 * r.y);
  // the odd contrasting fleck (multi-colour yarn)
  yarn = mix(yarn, uColC * 0.9, step(0.97, r.z) * (1.0 - band) * 0.5);
  // shade: crevices between loops and the pile-height wander
  yarn *= mix(0.68, 1.0, H.b) * (0.93 + 0.14 * fbm01(uv, vec2(5.0), 4, 0.5, 2.0));
  // traffic: a soft lighter flattened sheen in patches
  float wear = smoothstep(0.6, 0.9, fbm01(uv, vec2(2.0), 4, 0.5, 11.0));
  yarn = mix(yarn, yarn * 1.08 + 0.01, wear * 0.4);
  albedo = yarn * mix(0.7, 1.0, D.x);
  rough = 0.97 - wear * 0.05; metal = 0.0;
}
`;

/** Painted plaster with a roller stipple (orange peel), roller laps 23 cm wide running along V, a few soft scuffs. */
export const PLASTER = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float N1 = floor(uTile * 110.0);
  vec3 w = worley(uv * N1, vec2(N1), 1.0);
  float st = pow(smoothstep(0.75, 0.15, w.x), 0.6) * (0.6 + 0.4 * w.z);    // flat-topped stipple blobs
  float N2 = floor(uTile * 260.0);
  float fine = gnoise(uv * N2, vec2(N2), 2.0);
  float KX = floor(uTile / 0.23 + 0.5);
  float lap = vnoise(vec2(uv.x * KX, uv.y * floor(uTile * 3.0)), vec2(KX, floor(uTile * 3.0)), 3.0);
  float lapEdge = (1.0 - smoothstep(0.0, 0.035, min(fract(uv.x * KX), 1.0 - fract(uv.x * KX))))
                * step(0.5, vnoise(vec2(uv.x * KX, uv.y * floor(uTile * 6.0)), vec2(KX, floor(uTile * 6.0)), 4.0));
  float h = 0.5 + 0.22 * st * (0.6 + 0.6 * lap) + 0.05 * fine + 0.06 * lapEdge;
  h += 0.15 * fbm(uv, vec2(2.0), 4, 0.5, 5.0);    // the wall itself is not perfectly flat
  return vec4(h, lap, st, lapEdge);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec3 c = uCol * (0.97 + 0.05 * fbm01(uv, vec2(3.0), 4, 0.5, 11.0));
  c *= 0.985 + 0.03 * H.g;
  // scuffs: chair backs and shoulders, faint grey
  float sc = smoothstep(0.78, 0.95, fbm01(uv, vec2(3.0, 9.0), 5, 0.55, 12.0)) * 0.5;
  c = mix(c, c * vec3(0.86, 0.85, 0.84), sc * 0.5);
  albedo = c * mix(0.88, 1.0, D.x);
  // eggshell: stipple tops a bit shinier, each roller lap its own sheen
  rough = 0.82 - 0.08 * H.b + 0.07 * (H.g - 0.5); metal = 0.0;
}
`;

/**
 * Terrazzo: Voronoi marble chips in two sizes and specks in a warm cement binder, ground and polished, with brass
 * divider strips on a 1 m grid when uStrip = 1.
 */
export const TERRAZZO = /* glsl */ `
uniform vec3 uCol; uniform float uStrip;
// (layer 0 binder / 1 big chip / 2 small chip / 3 speck, chip id, pit)
vec3 terr(vec2 uv) {
  float N1 = floor(uTile * 19.0), N2 = floor(uTile * 55.0), N3 = floor(uTile * 200.0);
  // big chips: irregular (edge distance warped), about half the cells
  vec2 wq = vec2(fbm(uv, vec2(N1 * 0.5), 2, 0.5, 5.0), fbm(uv, vec2(N1 * 0.5), 2, 0.5, 6.0)) * 0.18 / N1;
  vec3 v1 = voronoiEdge((uv + wq) * N1, vec2(N1), 1.0, 0.95);
  if (v1.x > 0.11 && fract(v1.y * 7.31) < 0.5) return vec3(1.0, v1.y, 0.0);
  vec3 v2 = voronoiEdge(uv * N2, vec2(N2), 2.0, 0.95);
  if (v2.x > 0.16 && fract(v2.y * 5.17) < 0.4) return vec3(2.0, v2.y, 0.0);
  vec3 w3 = worley(uv * N3, vec2(N3), 3.0);
  if (w3.x < 0.3 && w3.z < 0.3) return vec3(3.0, w3.z * 3.3, 0.0);
  vec3 wp = worley(uv * N3 * 1.7, vec2(N3 * 1.7), 4.0);
  return vec3(0.0, 0.0, smoothstep(0.22, 0.08, wp.x) * step(0.82, wp.z));
}
float strip(vec2 uv) {
  if (uStrip < 0.5) return 0.0;
  vec2 m = uv * uTile; vec2 g = abs(fract(m + 0.5) - 0.5);   // distance to the 1 m grid lines (metres)
  return 1.0 - smoothstep(0.0012, 0.0022, min(g.x, g.y));
}
vec4 heightFn(vec2 uv) {
  vec3 t = terr(uv);
  float s = strip(uv);
  float h = 0.5 + 0.03 * step(0.5, t.x) - 0.5 * t.z + 0.02 * fbm(uv, vec2(4.0), 3, 0.5, 9.0);
  h = mix(h, 0.53, s);
  return vec4(h, t.x / 3.0, t.y, s);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float layer = floor(H.g * 3.0 + 0.5); float id = H.b;
  vec3 binder = uCol * (0.95 + 0.08 * fbm01(uv, vec2(24.0), 3, 0.5, 11.0));
  vec3 chip;
  float k = fract(id * 13.7);
  if (k < 0.42) chip = C(0xebe6db);          // white marble
  else if (k < 0.66) chip = C(0xa8a296);     // grey
  else if (k < 0.74) chip = C(0x3a3633);     // black
  else if (k < 0.9) chip = C(0xc0907a);      // rose / terracotta
  else chip = C(0x7d9580);                    // serpentine green
  chip *= 0.88 + 0.24 * fract(id * 31.1);
  // marble veining inside the chip
  chip *= 0.92 + 0.14 * fbm01(uv, vec2(40.0), 3, 0.5, 12.0);
  vec3 c = layer < 0.5 ? binder : chip;
  float pit = smoothstep(0.42, 0.3, H.r) * (layer < 0.5 ? 1.0 : 0.0);
  c *= 1.0 - pit * 0.5;
  // polished; footfall dulls it in soft patches
  float dull = smoothstep(0.5, 0.9, fbm01(uv, vec2(2.0), 4, 0.5, 13.0));
  rough = 0.11 + 0.12 * dull + (layer < 0.5 ? 0.05 : 0.0) + pit * 0.4;
  metal = 0.0;
  // brass divider strip
  vec3 brass = C(0xc09a52) * (0.9 + 0.15 * fbm01(uv, vec2(60.0, 3.0), 3, 0.5, 14.0));
  c = mix(c, brass, H.a); rough = mix(rough, 0.28, H.a); metal = mix(metal, 1.0, H.a);
  albedo = c;
}
`;

/** Honed limestone: pale, faint bedding, shell fragments, specks, tiny pores. */
export const LIMESTONE = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float N = floor(uTile * 160.0);
  vec3 w = worley(uv * N, vec2(N), 1.0);
  float pore = smoothstep(0.2, 0.05, w.x) * step(0.8, w.z);
  float h = 0.5 + 0.06 * fbm(uv, vec2(3.0), 4, 0.5, 2.0) - 0.4 * pore;
  float N2 = floor(uTile * 40.0);
  vec3 f = worley(uv * N2, vec2(N2), 3.0);
  float shell = smoothstep(0.05, 0.0, abs(f.x - 0.2)) * step(0.8, f.z) * step(0.5, fract(f.z * 17.0));   // shell arcs
  return vec4(h, pore, shell, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  // faint bedding, mostly a soft cloudy mottle; small dark grains and pale shell fragments
  float bed = fbm01(uv + vec2(0.0, 0.08 * fbm(uv, vec2(2.0), 3, 0.5, 4.0)), vec2(2.0, 8.0), 3, 0.5, 5.0);
  float cloud = fbm01(uv, vec2(3.0), 5, 0.55, 6.0);
  vec3 c = uCol * (0.97 + 0.04 * bed) * (0.92 + 0.14 * cloud);
  c = mix(c, c * vec3(1.03, 0.98, 0.9), smoothstep(0.55, 0.9, fbm01(uv, vec2(2.0), 4, 0.5, 7.0)) * 0.5);
  float N3 = floor(uTile * 220.0);
  vec3 sp = worley(uv * N3, vec2(N3), 7.0);
  float speck = smoothstep(0.35, 0.12, sp.x) * step(0.86, sp.z);
  c = mix(c, C(0x8a8274), speck * 0.55);
  c = mix(c, c * 1.12 + 0.02, H.b * 0.9);
  c *= 1.0 - H.g * 0.35;
  albedo = c * mix(0.9, 1.0, D.x);
  rough = 0.5 + 0.08 * (fbm01(uv, vec2(5.0), 4, 0.5, 8.0) - 0.5) + H.g * 0.3; metal = 0.0;
}
`;

/** 15 cm glazed ceramic tile, cushion edges, 3 mm recessed grout; per-tile tone and glaze waviness. */
export const TILE = /* glsl */ `
uniform vec3 uCol; uniform vec3 uGrout;
vec4 heightFn(vec2 uv) {
  float n = max(1.0, floor(uTile / 0.15 + 0.5));
  vec2 p = uv * n; vec2 c = floor(p); vec2 f = fract(p);
  float s = uTile / n;
  vec2 q = (f - 0.5) * s;
  float d = sdBox(q, vec2(s * 0.5 - 0.0016), 0.002);
  float body = roundBevel(d, 0.0028);
  vec3 th = h3(wrapc(ivec2(c), ivec2(n)), 3.0);
  float wav = fbm(uv, vec2(n * 2.0), 3, 0.5, 4.0) * 0.05;
  float h = 0.12 + 0.05 * gnoise(uv * n * 20.0, vec2(n * 20.0), 6.0);
  h = mix(h, 0.85 + wav + (th.x - 0.5) * 0.06, body);
  return vec4(h, body, th.y, th.z);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float body = smoothstep(0.2, 0.6, H.g);
  vec3 glaze = uCol * (0.94 + 0.1 * H.b);
  glaze = mix(glaze, glaze * vec3(1.03, 1.0, 0.95), H.a * 0.4);
  // pinholes and the faint mottle of the glaze
  float n = max(1.0, floor(uTile / 0.15 + 0.5));
  vec3 w = worley(uv * n * 14.0, vec2(n * 14.0), 7.0);
  glaze *= 1.0 - 0.06 * smoothstep(0.2, 0.05, w.x) * step(0.75, w.z);
  glaze *= 0.97 + 0.05 * fbm01(uv, vec2(n * 1.0), 3, 0.5, 8.0);
  float gd = smoothstep(0.4, 0.85, fbm01(uv, vec2(6.0), 4, 0.5, 9.0));
  vec3 grout = uGrout * (0.9 + 0.12 * fbm01(uv, vec2(40.0), 3, 0.5, 10.0)) * (1.0 - 0.3 * gd);
  albedo = mix(grout, glaze, body) * mix(0.75, 1.0, D.x);
  float scuff = smoothstep(0.65, 0.9, fbm01(uv, vec2(3.0), 4, 0.5, 11.0));
  rough = mix(0.88, 0.07 + 0.1 * scuff, body); metal = 0.0;
}
`;

/** Sheet linoleum: calendered speckle (marmoleum-like) in pale green, one weld seam per 2 m sheet, heel marks. */
export const LINO = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float h = 0.5 + 0.05 * fbm(uv, vec2(3.0), 4, 0.5, 1.0);
  float seam = 1.0 - smoothstep(0.0012, 0.0022, min(uv.x, 1.0 - uv.x) * uTile);
  h -= 0.3 * seam;
  float scr = scratches(uv, 5.0, 0.3, 3.0, 0.1, 0.5, 1.0, 0.25, 2.0);
  h -= 0.1 * scr;
  return vec4(h, seam, scr, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  // flecks elongated along V (the calender direction), slightly warped
  vec2 N = vec2(floor(uTile * 120.0), floor(uTile * 40.0));
  vec2 wq = vec2(0.012 * fbm(uv, vec2(3.0, 9.0), 3, 0.5, 3.0), 0.0);
  vec3 w = worley((uv + wq) * N, N, 4.0);
  float big = fbm01(uv + wq, vec2(2.0, 8.0), 4, 0.55, 5.0);
  vec3 c = uCol * (0.95 + 0.1 * big);
  float k = w.z;
  vec3 fl = k < 0.2 ? C(0xe2eadc) : k < 0.34 ? C(0x7fa98d) : k < 0.37 ? C(0x77756a) : c;
  c = mix(c, fl, smoothstep(0.6, 0.35, w.x) * 0.55);
  // weld seam rod a little darker
  c = mix(c, uCol * 0.75, H.g);
  // heel marks: short black arcs, rare
  float heel = smoothstep(0.1, 0.5, H.b) * step(0.5, fbm01(uv, vec2(3.0), 3, 0.5, 6.0));
  c = mix(c, C(0x2a2826), heel * 0.6);
  albedo = c * mix(0.85, 1.0, D.x);
  // waxed: smoother in the traffic patches
  rough = 0.42 - 0.12 * smoothstep(0.5, 0.85, fbm01(uv, vec2(2.0), 4, 0.5, 7.0)) + 0.2 * H.g; metal = 0.0;
}
`;

/** Planter loam with crumbs, bark-mulch chips, a few pebbles; moist patches darker and glossier. */
export const SOIL = /* glsl */ `
// mulch chips: (mask, along-chip coordinate, id, edge distance)
vec4 mulch(vec2 uv) {
  float N = floor(uTile * 13.0);
  vec2 p = uv * N; vec2 i = floor(p);
  vec4 best = vec4(0.0);
  // mulch lies in drifts: dense in patches, bare loam between
  float drift = fbm01(uv, vec2(3.0), 3, 0.5, 21.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 c = ivec2(i) + ivec2(x, y);
    for (int k = 0; k < 3; k++) {
      vec3 h = h3(wrapc(c, ivec2(N)), 5.0 + float(k) * 3.7);
      vec3 g = h3(wrapc(c, ivec2(N)), 9.0 + float(k) * 2.3);
      if (g.z > drift * 1.3 - 0.15) continue;
      vec2 ctr = vec2(c) + h.xy;
      float a = h.z * TAU;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 d = (p - ctr) / N * uTile;                 // metres
      vec2 q = vec2(dot(d, dir), dot(d, vec2(-dir.y, dir.x)));
      float L = 0.012 + 0.03 * g.x * g.x, Wd = 0.005 + 0.012 * g.y;
      // torn, irregular outline
      q.y += Wd * 0.35 * sin(q.x / L * 5.0 + h.x * 20.0);
      float sd = sdBox(q, vec2(L, Wd * (0.7 + 0.3 * cos(q.x / L * 2.0 + g.x * 9.0))), Wd * 0.5);
      if (sd < 0.0 && (best.x == 0.0 || g.y > best.z)) best = vec4(1.0, q.x / L, g.y, -sd / Wd);
    }
  }
  return best;
}
vec4 heightFn(vec2 uv) {
  float N1 = floor(uTile * 28.0);
  vec3 w1 = worley(uv * N1, vec2(N1), 1.0);
  float N2 = floor(uTile * 95.0);
  vec3 w2 = worley(uv * N2, vec2(N2), 2.0);
  float h = 0.35 + 0.18 * (1.0 - w1.x) + 0.1 * (1.0 - w2.x) + 0.12 * fbm(uv, vec2(4.0), 4, 0.5, 3.0);
  float N3 = floor(uTile * 40.0);
  vec3 ws = worley(uv * N3, vec2(N3), 4.0);
  float stone = step(0.985, ws.z) * dome(ws.x, 0.35);
  h = max(h, 0.45 + 0.35 * stone);
  vec4 m = mulch(uv);
  float mh = 0.62 + 0.2 * m.z + 0.08 * sat(m.w * 2.0) + 0.04 * sin(m.y * 30.0 + m.z * 9.0);
  h = mix(h, max(h, mh), m.x);
  return vec4(h, m.x, stone, m.y);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float moist = smoothstep(0.4, 0.8, fbm01(uv, vec2(5.0), 4, 0.5, 11.0)) * 0.6;
  vec3 loam = mix(C(0x4a3a2c), C(0x30241a), moist) * (0.82 + 0.3 * fbm01(uv, vec2(60.0), 3, 0.5, 12.0));
  // dry crumb tops paler, hollows dark
  loam = mix(loam, C(0x6a5846), sat(D.y * 6.0) * 0.5) * mix(0.5, 1.0, D.x);
  vec4 m = mulch(uv);
  float fibre = vnoise(vec2(m.y * 2.0, m.w * 6.0 + m.z * 40.0), vec2(4096.0), 13.0);
  vec3 bark = mix(C(0x4e3b2c), C(0x76604a), m.z) * (0.72 + 0.4 * fibre) * mix(0.7, 1.0, sat(m.w * 3.0));
  vec3 stone = C(0x7f786c) * (0.85 + 0.3 * fbm01(uv, vec2(80.0), 3, 0.5, 14.0));
  vec3 c = mix(loam, bark, H.g);
  c = mix(c, stone, sat(H.b * 3.0) * (1.0 - H.g));
  albedo = c;
  rough = mix(0.95, 0.72, moist) ;
  rough = mix(rough, 0.85, H.g); rough = mix(rough, 0.6, sat(H.b * 3.0) * (1.0 - H.g));
  metal = 0.0;
}
`;

/**
 * Leaf atlas (tile 1, UVs are atlas UVs): four 0.5 × 0.5 cells, base of the plant at the cell's v = 0 —
 *   (0, 0) broadleaf: one ovate fig leaf with an acuminate tip and its petiole
 *   (½, 0) frond: one fern frond, pinnae tapering to the tip
 *   (0, ½) blade: a clump of 7 grass blades from a common base
 *   (½, ½) flower: a shrub sprig — small leaves and three five-petal flowers
 * alpha = leaf coverage (alpha-tested, coverage-preserving mips); colour outside is dilated leaf green.
 */
export const LEAF = /* glsl */ `
// returns (inside 0/1, vein, petal, shade)
vec4 leafCell(vec2 uv) {
  vec2 cell = floor(uv * 2.0); vec2 l = fract(uv * 2.0);
  int id = int(cell.x) + 2 * int(cell.y);
  if (id == 0) {
    // fig leaf: midrib from (0.5, 0.1) to the tip at (0.5, 0.96), slight bow
    float t = (l.y - 0.1) / 0.86;
    float xm = 0.5 + 0.03 * sin(t * PI);
    float dx = l.x - xm;
    float hw = 0.0;
    if (t > 0.0 && t < 1.0) {
      hw = 0.21 * pow(sin(PI * pow(t, 0.62)), 0.8);
      hw *= 1.0 - 0.55 * smoothstep(0.7, 1.0, t);        // drawn-out (acuminate) tip
      hw *= 1.0 + 0.012 * sin(t * 90.0);
    }
    float inside = step(abs(dx), hw);
    float pet = step(abs(dx), 0.012) * step(0.0, l.y) * step(l.y, 0.12);
    // veins: midrib + secondaries running up and out
    float mid = 1.0 - smoothstep(0.004, 0.011, abs(dx));
    float ph = t * 15.0 - abs(dx) * 22.0;
    float sec = (1.0 - smoothstep(0.0, 0.07, abs(fract(ph) - 0.5) - 0.42)) * step(0.03, abs(dx)) * smoothstep(0.0, 0.2, hw - abs(dx));
    float vein = max(mid, sec * 0.6);
    float shade = abs(dx) / max(hw, 1e-3);
    return vec4(max(inside, pet), vein, pet * 0.0, shade);
  }
  if (id == 1) {
    // fern frond: rachis up the middle, ~22 pinna pairs angled 55° up, shrinking to the tip
    float xm = 0.5 + 0.05 * sin(l.y * 2.2);
    float dx = l.x - xm; float ax = abs(dx);
    float rach = step(ax, 0.007 * (1.2 - l.y)) * step(0.02, l.y) * step(l.y, 0.97);
    float sp = 0.04; float cotA = 0.7;
    float inside = rach; float vein = rach;
    float shade = 0.0;
    float k0 = floor((l.y - ax * cotA - 0.08) / sp + 0.5);
    for (int j = -1; j <= 1; j++) {
      float k = k0 + float(j);
      float t0 = 0.08 + k * sp + (dx > 0.0 ? sp * 0.5 : 0.0);
      if (t0 < 0.06 || t0 > 0.95) continue;
      float tt = (t0 - 0.06) / 0.89;
      float L = 0.38 * sin(PI * min(1.0, 0.25 + tt * 0.85)) * (1.0 - 0.75 * tt);
      vec2 dir = normalize(vec2(sign(dx), cotA));
      vec2 rel = vec2(ax, l.y - t0) * vec2(1.0, 1.0);
      vec2 dd = normalize(vec2(1.0, cotA));
      float u = dot(rel, dd);
      float v = rel.x * dd.y - rel.y * dd.x;
      if (u < 0.0 || u > L) continue;
      float s = u / L;
      float w = 0.018 * pow(1.0 - s, 0.6) * (0.75 + 0.25 * abs(sin(s * 28.0)));
      if (abs(v) < w) { inside = 1.0; vein = max(vein, 1.0 - smoothstep(0.0015, 0.004, abs(v))); shade = abs(v) / w; }
    }
    return vec4(inside, vein, 0.0, shade);
  }
  if (id == 2) {
    // grass clump: 7 blades from the base
    float inside = 0.0, vein = 0.0, shade = 0.0;
    for (int j = 0; j < 7; j++) {
      float fj = float(j);
      vec3 h = h3(ivec2(j, 3), 21.0);
      float xb = 0.42 + 0.16 * (fj / 6.0);
      float len = 0.6 + 0.37 * h.x;
      float lean = (fj / 6.0 - 0.5) * 0.5 + (h.y - 0.5) * 0.2;
      float bend = (h.z - 0.5) * 0.5 + sign(lean) * 0.18;
      float y = l.y - 0.02;
      if (y < 0.0 || y > len) continue;
      float s = y / len;
      float xc = xb + lean * y + bend * y * y;
      float w = 0.016 * pow(1.0 - s, 0.7) + 0.001;
      float d = abs(l.x - xc);
      if (d < w) { inside = 1.0; vein = max(vein, 1.0 - smoothstep(0.0, 0.003, d)); shade = s; }
    }
    return vec4(inside, vein, 0.0, shade);
  }
  // flowering sprig: stem, alternate small leaves, three flowers at the top
  float inside = 0.0, vein = 0.0, petal = 0.0, shade = 0.0;
  float xs = 0.5 + 0.04 * sin(l.y * 5.0);
  if (abs(l.x - xs) < 0.006 && l.y > 0.02 && l.y < 0.78) { inside = 1.0; vein = 1.0; }
  for (int j = 0; j < 8; j++) {
    float fj = float(j);
    float ty = 0.1 + fj * 0.085;
    float side = mod(fj, 2.0) * 2.0 - 1.0;
    vec2 base = vec2(0.5 + 0.04 * sin(ty * 5.0), ty);
    vec2 dir = normalize(vec2(side, 0.9));
    vec2 rel = l - base;
    float u = dot(rel, dir), v = rel.x * dir.y - rel.y * dir.x;
    float L = 0.16 - fj * 0.008;
    if (u > 0.0 && u < L) {
      float s = u / L;
      float w = 0.05 * pow(sin(PI * pow(s, 0.8)), 0.8) * (L / 0.16);
      if (abs(v) < w) { inside = 1.0; vein = max(vein, 1.0 - smoothstep(0.002, 0.005, abs(v))); shade = abs(v) / w; }
    }
  }
  for (int j = 0; j < 3; j++) {
    float fj = float(j);
    vec2 c = vec2(0.5 + (fj - 1.0) * 0.17, 0.8 + 0.08 * (1.0 - abs(fj - 1.0)));
    vec2 r = l - c; float a = atan(r.y, r.x) + fj; float rr = length(r);
    float R = 0.09 * (0.55 + 0.45 * abs(cos(2.5 * a)));
    if (rr < R) { inside = 1.0; petal = 1.0; vein = rr < 0.022 ? 1.0 : 0.0; shade = rr / R; }
  }
  return vec4(inside, vein, petal, shade);
}
vec4 heightFn(vec2 uv) {
  vec4 L = leafCell(uv);
  float h = L.x * (0.5 + 0.25 * (1.0 - L.w * L.w)) + L.y * 0.08 * L.x;
  h += 0.04 * fbm(uv, vec2(16.0), 3, 0.5, 2.0) * L.x;
  return vec4(h, L.x, L.y, L.z);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec4 L = leafCell(uv);
  vec2 cell = floor(uv * 2.0);
  int id = int(cell.x) + 2 * int(cell.y);
  vec3 g = id == 0 ? C(0x2f5a24) : id == 1 ? C(0x4c7a2a) : id == 2 ? C(0x5b7d30) : C(0x3a6228);
  float n = fbm01(uv, vec2(24.0), 4, 0.5, 5.0);
  vec3 c = g * (0.82 + 0.35 * n);
  c = mix(c, c * vec3(1.25, 1.3, 0.85), L.y * 0.55);                          // paler veins
  c = mix(c, c * vec3(1.25, 1.18, 0.7), smoothstep(0.75, 1.0, L.w) * 0.35);    // yellowish margins
  if (id == 2) c = mix(c, C(0xa9a35a), smoothstep(0.7, 1.0, L.w) * 0.6);         // dry grass tips
  if (L.z > 0.5) c = L.y > 0.5 ? C(0xe8c34a) : mix(C(0xf2d6dc), C(0xe48aa4), smoothstep(0.2, 1.0, L.w));
  // the odd brown spot on a fig leaf
  if (id == 0) c = mix(c, C(0x6a5a2a), step(0.93, worley(uv * 40.0, vec2(40.0), 6.0).z) * smoothstep(0.25, 0.1, worley(uv * 40.0, vec2(40.0), 6.0).x) * 0.7);
  // dilate the leaf colour into the holes so mips never fringe dark
  albedo = L.x > 0.5 ? c * mix(0.8, 1.0, D.x) : g * 0.95;
  alpha = L.x;
  rough = id == 0 ? 0.42 : id == 1 ? 0.6 : id == 2 ? 0.62 : 0.55;
  if (L.z > 0.5) rough = 0.7;
  metal = 0.0;
}
`;

/** Smooth fig bark: pale grey, elephant-skin creases around the trunk (along U), lenticels, a little green algae. */
export const BARK = /* glsl */ `
vec4 heightFn(vec2 uv) {
  // smooth skin with broad swellings, faint vertical stretch lines
  float h = 0.5 + 0.16 * fbm(uv, vec2(3.0, 5.0), 4, 0.5, 1.0);
  h += 0.035 * gnoise(uv * vec2(90.0, 5.0), vec2(90.0, 5.0), 4.0);
  // elephant-skin wrinkles: soft, wavy, broken rings around the trunk (along U), in groups
  float cy = uv.y * 14.0 + 0.35 * fbm(uv, vec2(6.0, 3.0), 3, 0.5, 2.0);
  float grp = smoothstep(0.4, 0.7, fbm01(uv, vec2(2.0, 3.0), 3, 0.5, 9.0));
  float cr = (1.0 - smoothstep(0.0, 0.14, abs(fract(cy) - 0.5))) * grp;
  cr *= smoothstep(0.35, 0.6, vnoise(vec2(uv.x * 18.0, floor(cy)), vec2(18.0, 4096.0), 3.0));
  h -= 0.12 * cr;
  // lenticels: tiny pale horizontal dashes
  vec3 w = worley(uv * vec2(70.0, 220.0), vec2(70.0, 220.0), 5.0);
  float len = smoothstep(0.25, 0.08, w.x) * step(0.88, w.z);
  h += 0.04 * len;
  return vec4(h, cr, len, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float n = fbm01(uv, vec2(3.0, 6.0), 5, 0.55, 11.0);
  vec3 c = mix(C(0x6e6b62), C(0x908c80), n);
  // paler and darker blotches, a little green on one side
  c *= 0.9 + 0.2 * fbm01(uv, vec2(5.0, 9.0), 4, 0.5, 13.0);
  float alg = smoothstep(0.66, 0.88, fbm01(uv, vec2(2.0, 5.0), 4, 0.55, 12.0));
  c = mix(c, C(0x5d6648), alg * 0.35);
  c = mix(c, c * 0.82, H.g * 0.8);
  c = mix(c, C(0xa89c84), H.b * 0.5);
  albedo = c * mix(0.75, 1.0, D.x);
  rough = 0.7 + 0.12 * n + 0.08 * H.g; metal = 0.0;
}
`;

/** Water: a dark deep body; the height is a sum of periodic ripple trains (the normal map is scrolled twice live). */
export const WATER = /* glsl */ `
vec4 heightFn(vec2 uv) {
  float h = 0.0;
  // integer wave vectors keep it tileable; amplitude ~ 1/|k|
  h += 0.22 * sin(TAU * dot(uv, vec2(3.0, 1.0)) + 0.4);
  h += 0.16 * sin(TAU * dot(uv, vec2(-2.0, 5.0)) + 1.9);
  h += 0.11 * sin(TAU * dot(uv, vec2(7.0, -4.0)) + 3.1);
  h += 0.08 * sin(TAU * dot(uv, vec2(1.0, 11.0)) + 0.7);
  h += 0.06 * sin(TAU * dot(uv, vec2(-13.0, 6.0)) + 5.3);
  h += 0.05 * sin(TAU * dot(uv, vec2(17.0, 12.0)) + 2.2);
  h += 0.12 * fbm(uv, vec2(6.0), 4, 0.5, 1.0);
  return vec4(0.5 + 0.5 * h, 0.0, 0.0, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  // deep teal-black body: almost all of what is seen is the reflection
  albedo = mix(C(0x081816), C(0x0e2522), fbm01(uv, vec2(2.0), 3, 0.5, 2.0));
  rough = 0.03; metal = 0.0;
}
`;

/** Clean architectural glass: mostly clear; faint fingerprints, a few specks, a hairline scratch or two. */
export const GLASS_CLEAN = /* glsl */ `
vec4 heightFn(vec2 uv) {
  float h = 0.5 + 0.01 * fbm(uv, vec2(2.0), 3, 0.5, 1.0);
  float scr = scratches(uv, 6.0, 0.2, 3.0, 0.1, 0.6, 0.6, 0.12, 2.0);
  h -= 0.06 * scr;
  return vec4(h, scr, 0.0, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  // fingerprints: small oval prints (~2–3 cm) with fine ridges, in loose clusters; a soft wipe haze
  vec3 fw = worley(uv * vec2(24.0, 20.0), vec2(24.0, 20.0), 11.0);
  float cluster = smoothstep(0.55, 0.8, fbm01(uv, vec2(3.0), 3, 0.5, 15.0));
  float print = smoothstep(0.42, 0.22, fw.x) * step(0.55, fw.z) * cluster;
  print *= 0.6 + 0.4 * sin(fw.x * 260.0 + fw.z * 40.0);
  float haze = smoothstep(0.6, 0.9, fbm01(uv, vec2(2.0), 4, 0.5, 16.0)) * 0.5;
  vec3 sw = worley(uv * 90.0, vec2(90.0), 13.0);
  float specks = step(0.993, sw.z) * smoothstep(0.2, 0.06, sw.x);
  albedo = mix(vec3(0.62, 0.68, 0.67), C(0x8a857a), specks);
  rough = 0.012 + 0.16 * print + 0.08 * haze + 0.25 * H.g + 0.3 * specks;
  metal = 0.0;
  alpha = sat(0.025 + print * 0.012 + haze * 0.01 + specks * 0.3 + H.g * 0.06);
}
`;
