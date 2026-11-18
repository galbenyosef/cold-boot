/**
 * Stage 3c navy dock set (docs/plans/stage-3c.md §8.9, §2.6, §2.9). Same contract as the other bodies: `heightFn`
 * (height + masks) and `surf`, tileable over the tile, authored in metres (`uv * uTile`).
 *
 * A military dock 2.1 km down: off-white enamel on riveted pressure-hull strakes that sweat condensation, galvanised
 * bar grating blooming white in the damp, standing water on the decks, ribbed rubber matting with wet boot prints,
 * and the detachment's kit (rip-stop fatigues, a knit balaclava, a matte helmet, ranger-green webbing). Four look
 * extras the contract does not name yet (`NAVY_EXTRAS`): the boat's anechoic tile coating, barracks lino, a wool
 * blanket, and deck hazard paint worn through by boots.
 *
 * Rules carried from 3b: albedos ≤ ~0.85 sRGB (the enamel holds under the 4000 K lamp at ACES exposure 1), no stacked
 * darkening, and no low-frequency albedo mottle on large flat panels (the `stainless` complaint: ≤ 2 % plate-to-plate,
 * the rest of the life is in roughness and the normal). Nothing is near-black: the darkest albedo (black hazard
 * stripes, the balaclava, the coating) stays ≥ 0.11 sRGB so a 0.3 red emergency point still draws it.
 */

/**
 * hull_white: 3 m tile = two 1.5 m strakes. Each strake seam carries a riveted butt strap (130 mm, two rivet rows at
 * 75 mm pitch); welded plate butts are staggered (x 0.6 in the lower strake, 2.1 in the upper). Plates are slightly
 * oil-canned; the enamel has an orange peel. Condensation: droplets gather under each strap and in cold lanes, and run
 * down in thin wet trails; a few rivets bleed rust. Wetness lives in roughness (0.03 droplets, 0.08 trails), so it reads
 * through the probes and the flashlight's highlight, not as dark blotches.
 */
export const HULL_WHITE = /* glsl */ `
uniform vec3 uCol; uniform float uWet;
float seamY(float y) { return floor(y / 1.5 + 0.5) * 1.5; }
float buttX(float strake) { return strake < 0.5 ? 0.6 : 2.1; }
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float sy = seamY(m.y), ry = m.y - sy, sd = abs(ry);
  float strake = floor(m.y / 1.5);
  float bx = abs(mod(m.x - buttX(strake) + 1.5, 3.0) - 1.5);
  float strap = 1.0 - smoothstep(0.062, 0.068, sd);
  float h = 0.34;
  // oil-canning: each plate dished a little differently (normal only, the albedo stays flat)
  h += 0.07 * fbm(uv + vec2(0.0, strake * 0.37), vec2(2.0, 4.0), 3, 0.5, 1.0);
  float N = floor(uTile * 150.0);
  h += 0.006 * gnoise(uv * N, vec2(N), 2.0);
  // the strap plate and its edge fillet weld (rippled)
  float fil = dome(abs(sd - 0.069), 0.006) * (1.0 - strap);
  float rip = 0.85 + 0.15 * sin(m.x * TAU / 0.011);
  h = mix(h, 0.6 + 0.01 * gnoise(uv * N, vec2(N), 3.0), strap);
  h += 0.14 * fil * rip;
  // rivet heads: two rows on the strap, 75 mm pitch (40 per tile)
  float rx = mod(m.x, 0.075) - 0.0375;
  float dr = min(length(vec2(rx, ry - 0.033)), length(vec2(rx, ry + 0.033)));
  float rv = dome(dr, 0.0095);
  h += 0.22 * rv;
  // butt weld bead (between straps)
  float wb = dome(bx, 0.008) * (1.0 - strap);
  h += 0.2 * wb * (0.85 + 0.15 * sin(m.y * TAU / 0.01));
  // condensation droplets: denser in the 0.35 m under each strap and in cold lanes
  float NC = floor(uTile * 55.0);
  vec3 w = worley(uv * NC, vec2(NC), 4.0);
  float below = ry < 0.0 ? smoothstep(0.3, 0.08, sd) : 0.0;
  float lane = smoothstep(0.55, 0.8, fbm01(uv, vec2(6.0, 2.0), 4, 0.5, 5.0));
  float dens = 0.015 + 0.28 * below + 0.06 * lane;
  float rad = mix(0.0022, 0.0055, fract(w.z * 37.0)) * NC / uTile;   // droplet radius in cell units
  float drop = step(w.z, dens) * dome(w.x, rad) * (1.0 - strap);
  h += 0.05 * drop;
  // run trails from the strap's lower edge down the plate
  float tr = max(dripsBelow(m, 1.5 - 0.07, 7.0, 1.35, 6.0), dripsBelow(m, 3.0 - 0.07, 7.0, 1.35, 7.0));
  h += 0.015 * tr;
  return vec4(h, max(strap, rv), max(tr, drop), drop);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float strake = floor(m.y / 1.5);
  float sy = seamY(m.y);
  // (a plate runs butt to butt across the tile edge, so each strake is one plate: one id per strake)
  float pid = h1(ivec2(int(strake), 0), 3.0);
  float mott = fbm01(uv, vec2(3.0), 4, 0.5, 11.0);
  vec3 c = uCol * (0.99 + 0.02 * (pid - 0.5) + 0.016 * (mott - 0.5));
  // the straps had a later coat: a hair cooler
  float strap = 1.0 - smoothstep(0.062, 0.068, abs(m.y - sy));
  c = mix(c, uCol * vec3(0.975, 0.98, 0.985), strap * 0.7);
  rough = 0.32 + 0.05 * (mott - 0.5) + 0.04 * strap;
  // light grime in the cavities round the rivets and the fillet
  float g = grimeAmount(uv, D, 0.35, 19.0);
  c = mix(c, C(0x6f6b60), g * 0.35);
  // chips on rivet heads and weld beads, through to the grey primer
  float ch = chipMask(uv, 12.0, edgeMask(D, 0.05, 0.3), -0.12, 21.0).x * smoothstep(0.1, 0.5, H.g + edgeMask(D, 0.05, 0.3));
  c = mix(c, C(0x6a6f72), ch);
  rough = mix(rough, 0.55, ch);
  // rust bleed under a few rivets
  float sel = smoothstep(0.62, 0.7, fbm01(uv, vec2(5.0), 3, 0.5, 23.0));
  float rb = max(dripsBelow(m, 1.5 - 0.04, 13.3, 0.22, 24.0), dripsBelow(m, 3.0 - 0.04, 13.3, 0.22, 25.0)) * sel;
  c = mix(c, C(0x9c5c32), rb * 0.45);
  // wet: trails glossy and a touch greyer, droplets glass-smooth (they glint; they must not read as dirt)
  float wet = H.b * uWet, drop = H.a;
  c *= 1.0 - 0.07 * wet;
  rough = mix(rough, 0.08, smoothstep(0.05, 0.4, wet));
  rough = mix(rough, 0.03, drop);
  albedo = c * mix(0.88, 1.0, D.x);
  metal = 0.0;
}
`;

/**
 * deck_grate: bar grating, bearing bars 30 × 5 mm at 40 mm (25 / m) with serrated tops, press-locked 3 mm cross bars
 * every 100 mm. Hot-dip galvanised and kept damp: dull zinc, a white zinc-oxide bloom in patches, the serrated tops
 * worn bright where boots go. Alpha 0 in the openings (alpha-tested, double-sided, casts).
 */
export const DECK_GRATE = /* glsl */ `
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float bx = abs(fract(m.x * 25.0) - 0.5) / 25.0;
  float cy = abs(fract(m.y * 10.0) - 0.5) / 10.0;
  float bear = 1.0 - smoothstep(0.0024, 0.0030, bx);
  float cross = 1.0 - smoothstep(0.0013, 0.0019, cy);
  // serrations: a notch every 12.5 mm along the bearing bar
  float tooth = abs(fract(m.y * 80.0) - 0.5) * 2.0;
  float serr = smoothstep(0.12, 0.42, tooth);
  float hb = 0.84 + 0.1 * dome(bx, 0.003) - 0.16 * (1.0 - serr);
  float hc = 0.8 + 0.06 * dome(cy, 0.0019);
  float h = max(hb * bear, hc * cross);
  float a = max(bear, cross);
  h += 0.03 * fbm(uv, vec2(8.0), 3, 0.5, 4.0) * a;
  return vec4(h, a, bear * serr, cross);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float a = H.g;
  float mott = fbm01(uv, vec2(5.0), 4, 0.5, 11.0);
  vec3 sp = worley(uv * 45.0, vec2(45.0), 12.0);
  // zinc: dull, spangled; kept below full metalness so it still reads in the dark (diffuse share)
  vec3 zinc = vec3(0.56, 0.58, 0.59) * (0.88 + 0.16 * sp.z) * (0.93 + 0.1 * mott);
  albedo = zinc; metal = 0.62; rough = 0.5 + 0.14 * sp.z + 0.08 * mott;
  // boot-worn serration tops: bright, smooth
  float lane = smoothstep(0.35, 0.75, fbm01(uv, vec2(2.0), 3, 0.5, 13.0));
  float top = smoothstep(0.3, 0.9, H.b) * lane;
  albedo = mix(albedo, vec3(0.74, 0.76, 0.78), top * 0.6); rough = mix(rough, 0.26, top * 0.7); metal = mix(metal, 0.9, top * 0.6);
  // white rust bloom in the damp (dielectric, chalky)
  float bloom = smoothstep(0.55, 0.78, fbm01(uv, vec2(4.0), 5, 0.55, 14.0)) * (1.0 - top);
  bloom = max(bloom, (1.0 - D.x) * 0.9 * smoothstep(0.4, 0.7, fbm01(uv, vec2(12.0), 3, 0.5, 15.0)));
  albedo = mix(albedo, vec3(0.78, 0.78, 0.75) * (0.9 + 0.1 * mott), bloom * 0.7); rough = mix(rough, 0.9, bloom * 0.7); metal *= 1.0 - bloom * 0.8;
  // a little dark grime in the joints, rare rust at the cross-bar notches
  float g = sat((1.0 - D.x) * 1.2) * 0.5;
  albedo = mix(albedo, C(0x34322c), g * 0.5); metal *= 1.0 - g * 0.5;
  float rust = smoothstep(0.7, 0.85, fbm01(uv, vec2(9.0), 5, 0.55, 16.0)) * H.a;
  albedo = mix(albedo, C(0x7a4422), rust * 0.7); rough = mix(rough, 0.85, rust); metal *= 1.0 - rust;
  alpha = smoothstep(0.35, 0.65, a);
}
`;

/**
 * wet_steel: standing-water overlay (transparent; one puddle per 2 m tile, alpha → 0 well inside the tile edge, so a
 * patch quad of ≤ 2 × 2 m UV-metres shows one whole puddle). Rendered with the `water` shading variant (two scrolling
 * ripple samples, `userData.flow`), roughness 0.06, metalness 0.2: what reads is the probe's reflection and the lamp
 * highlight; the body is a dark film that darkens the deck under it by ~half. A pale dried tide line at the rim.
 */
export const WET_STEEL = /* glsl */ `
float puddleR(vec2 m) {
  vec2 q = (m - vec2(1.0)) / vec2(0.8, 0.62);
  return length(q) + 0.36 * fbm(m / uTile, vec2(3.0), 4, 0.5, 2.0);
}
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float r = puddleR(m);
  float edge = min(min(m.x, uTile - m.x), min(m.y, uTile - m.y));
  float keep = smoothstep(0.06, 0.3, edge);
  float pud = smoothstep(1.0, 0.86, r) * keep;
  // satellite drops round the rim
  vec3 w = worley(uv * 9.0, vec2(9.0), 3.0);
  float sat2 = smoothstep(0.32, 0.18, w.x) * step(0.72, w.z) * smoothstep(1.45, 1.0, r) * keep;
  pud = max(pud, sat2);
  float rim = smoothstep(0.84, 0.93, r) * (1.0 - smoothstep(0.95, 1.02, r)) * keep;
  float h = 0.5;
  h += pud * (0.18 * sin(TAU * dot(uv, vec2(3.0, 1.0)) + 0.4) + 0.13 * sin(TAU * dot(uv, vec2(-2.0, 5.0)) + 1.9)
            + 0.09 * sin(TAU * dot(uv, vec2(7.0, -4.0)) + 3.1) + 0.06 * sin(TAU * dot(uv, vec2(1.0, 11.0)) + 0.7)
            + 0.1 * fbm(uv, vec2(8.0), 4, 0.5, 1.0));
  return vec4(h, pud, rim, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float pud = H.g, rim = H.b;
  albedo = mix(C(0x1d2124), C(0x262a2c), fbm01(uv, vec2(3.0), 3, 0.5, 4.0));
  albedo = mix(albedo, C(0x7c7b75), rim * 0.3);
  rough = mix(0.06, 0.45, rim);
  metal = 0.2 * (1.0 - rim);
  alpha = sat(pud * 0.72 + rim * 0.12);
}
`;

/** fatigue_navy: rip-stop poplin — a fine weave grain with the heavier rip-stop grid every 6.25 mm (40 per tile). */
export const FATIGUE = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  vec2 g = abs(fract(uv * 40.0) - 0.5);
  float rs = max(1.0 - smoothstep(0.035, 0.075, g.x), 1.0 - smoothstep(0.035, 0.075, g.y));
  float h = 0.45 + 0.07 * gnoise(uv * vec2(160.0, 40.0), vec2(160.0, 40.0), 1.0) + 0.07 * gnoise(uv * vec2(40.0, 160.0), vec2(40.0, 160.0), 2.0);
  h += 0.04 * gnoise(uv * 220.0, vec2(220.0), 3.0);
  h += 0.25 * rs;
  h += 0.08 * fbm(uv, vec2(3.0), 4, 0.5, 4.0);
  return vec4(h, rs, 0.0, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float rs = H.g;
  float heather = fbm01(uv, vec2(24.0), 3, 0.5, 11.0);
  vec3 c = uCol * (0.95 + 0.08 * heather);
  // rip-stop yarn: nylon, a little paler and smoother
  c = mix(c, uCol * 1.12, rs * 0.45);
  // washed-out patches (sun and laundry), soft
  float fade = smoothstep(0.6, 0.85, fbm01(uv, vec2(2.0), 4, 0.5, 12.0));
  c = mix(c, c * vec3(1.08, 1.1, 1.12), fade * 0.5);
  albedo = c * mix(0.75, 1.0, D.x);
  rough = 0.86 - 0.1 * rs; metal = 0.0;
}
`;

/** knit_black: stockinette knit, 2.5 × 2 mm stitches (40 × 50 per 0.1 m tile), each a V of two leaning loop legs; fuzz. */
export const KNIT = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  vec2 p = uv * vec2(40.0, 50.0);
  vec2 f = fract(p) - 0.5;
  float best = 0.0;
  for (int k = 0; k < 2; k++) {
    float sx = k == 0 ? -1.0 : 1.0;
    vec2 q = f - vec2(0.23 * sx, 0.0);
    float a = 0.5 * sx;
    vec2 r = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
    float e = length(r / vec2(0.2, 0.58));
    best = max(best, sqrt(max(0.0, 1.0 - e * e)));
  }
  float fuzz = gnoise(uv * 240.0, vec2(240.0), 2.0);
  float h = 0.15 + 0.7 * best + 0.07 * fuzz + 0.05 * fbm(uv, vec2(4.0), 3, 0.5, 3.0);
  return vec4(h, best, fuzz, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float yarn = H.g;
  vec2 c = floor(uv * vec2(40.0, 50.0));
  float slub = h1(ivec2(int(c.x), int(c.y) / 3), 5.0);
  vec3 col = uCol * (0.8 + 0.35 * yarn) * (0.94 + 0.1 * slub);
  // lint and pale fibres caught in the knit
  float lint = smoothstep(0.86, 0.95, fbm01(uv, vec2(16.0), 3, 0.5, 6.0)) * step(0.5, H.b + 0.5);
  col = mix(col, C(0x6a6a68), lint * 0.25);
  albedo = col * mix(0.7, 1.0, D.x);
  rough = 0.93 - 0.06 * yarn; metal = 0.0;
}
`;

/**
 * webbing: 500D nylon (2 × 2 basket weave, ~1 mm yarn) under MOLLE rows — 25 mm webbing straps at 35.7 mm pitch
 * (7 per 0.25 m tile), each with fine lengthwise ribs, edge stitching and a bar-tack every 35.7 mm.
 */
export const WEBBING = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float rowD = abs(fract(m.y * 28.0) - 0.5) / 28.0;
  float strap = 1.0 - smoothstep(0.0122, 0.0128, rowD);
  vec2 p = uv * 64.0; vec2 cc = floor(p); vec2 f2 = fract(p * 2.0);
  float chk = mod(cc.x + cc.y, 2.0);
  float base = chk > 0.5 ? sin(f2.x * PI) : sin(f2.y * PI);
  float rib = sin(fract(uv.y * 112.0) * PI);
  float bar = (1.0 - smoothstep(0.035, 0.06, abs(fract(m.x * 28.0) - 0.5))) * strap * (1.0 - smoothstep(0.009, 0.011, rowD));
  float edgeSt = (1.0 - smoothstep(0.0007, 0.0012, abs(rowD - 0.0105))) * step(0.45, fract(m.x * 400.0)) * strap;
  float stitch = max(bar, edgeSt);
  float h = mix(0.25 + 0.15 * base, 0.62 + 0.08 * rib + 0.05 * dome(rowD, 0.0125), strap);
  h += 0.08 * stitch;
  h += 0.03 * gnoise(uv * 200.0, vec2(200.0), 3.0);
  return vec4(h, strap, stitch, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float strap = H.g, st = H.b;
  float mott = fbm01(uv, vec2(4.0), 4, 0.5, 11.0);
  vec3 c = uCol * (0.94 + 0.08 * mott);
  c = mix(c, uCol * vec3(0.93, 0.96, 0.9), strap);
  c = mix(c, uCol * 1.18, st * 0.5);
  // frayed, paler strap edges and a little dust in the weave
  float fray = edgeMask(D, 0.08, 0.3) * strap;
  c = mix(c, c * 1.2, fray * 0.5);
  float g = grimeAmount(uv, D, 0.4, 13.0);
  c = mix(c, C(0x5a5548), g * 0.35);
  albedo = c * mix(0.75, 1.0, D.x);
  rough = mix(0.82, 0.68, strap) + 0.05 * g; metal = 0.0;
}
`;

/**
 * rubber_mat: ribbed rubber runner matting (ready room), 1 m wide runners (butt seam at x 0 / 1 m), ribs 8 mm pitch
 * along V. Boot prints in 0.5 m cells (a third of them): half still wet (glossy, darker), half dried to grey dust.
 */
export const RUBBER_MAT = /* glsl */ `
uniform vec3 uCol;
float sole(vec2 q) {
  // q in metres in the print's frame (y along the foot): a rounded fore-sole and a separate heel
  float fore = sdBox(q - vec2(0.0, 0.055), vec2(0.045, 0.085), 0.04);
  float heel = sdBox(q - vec2(0.0, -0.095), vec2(0.037, 0.04), 0.03);
  return min(fore, heel);
}
float prints(vec2 m, out float wetK) {
  vec2 cell = floor(m / 0.5);
  vec2 cw = mod(cell, uTile / 0.5);
  vec3 h = h3(ivec2(cw), 9.0);
  vec3 h2 = h3(ivec2(cw), 10.0);
  wetK = step(0.5, h2.x);
  if (h.z > 0.36) return 0.0;
  vec2 c = (cell + 0.5) * 0.5 + (h.xy - 0.5) * 0.12;
  float a = (h2.y - 0.5) * 0.8 + (h2.z < 0.5 ? 0.0 : PI);
  vec2 d = m - c;
  vec2 q = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
  float s = sole(q);
  // lugs: the tread breaks the print up
  float lug = step(0.35, fract(q.y * 55.0)) * step(0.3, fract(q.x * 45.0 + 0.5 * step(0.5, fract(q.y * 27.5))));
  return (1.0 - smoothstep(-0.004, 0.003, s)) * mix(0.55, 1.0, lug) * (0.6 + 0.4 * h2.y);
}
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float q = fract(m.x * 125.0);
  float rib = smoothstep(0.16, 0.3, q) * (1.0 - smoothstep(0.7, 0.84, q));
  float sd = abs(fract(m.x + 0.5) - 0.5);
  float seam = 1.0 - smoothstep(0.0015, 0.003, sd);
  float h = 0.3 + 0.4 * rib - 0.3 * seam;
  h += 0.02 * fbm(uv, vec2(6.0), 4, 0.5, 5.0);
  h += 0.015 * gnoise(uv * 700.0, vec2(700.0), 6.0);
  float scr = scratches(uv, 16.0, 1.57, 1.2, 0.1, 0.5, 1.2, 0.4, 7.0);
  h -= 0.06 * scr * rib;
  float wk;
  float pr = prints(m, wk);
  return vec4(h, rib, pr * (wk > 0.5 ? 1.0 : -1.0) * 0.5 + 0.5, seam);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float rib = H.g, seam = H.a;
  float pr = abs(H.b - 0.5) * 2.0, wet = step(0.5, H.b) * pr, dry = step(H.b, 0.5) * pr;
  float mott = fbm01(uv, vec2(4.0), 4, 0.5, 11.0);
  vec3 c = uCol * (0.94 + 0.08 * mott);
  float traffic = smoothstep(0.35, 0.8, fbm01(uv, vec2(2.0), 3, 0.5, 12.0));
  c = mix(c, c * 1.18, rib * traffic * 0.6);
  rough = 0.8 - 0.12 * rib * traffic;
  // grey dust in the grooves
  float dust = (1.0 - rib) * smoothstep(0.35, 0.8, fbm01(uv, vec2(10.0), 4, 0.5, 13.0));
  c = mix(c, C(0x5c5a54), dust * 0.4); rough = mix(rough, 0.95, dust * 0.6);
  c = mix(c, c * 0.6, seam);
  // prints: wet = dark and glossy, dried = grey and chalky
  c = mix(c, c * 0.72, wet); rough = mix(rough, 0.16, wet);
  c = mix(c, C(0x5f5c55), dry * 0.35); rough = mix(rough, 0.95, dry * 0.7);
  albedo = c * mix(0.75, 1.0, D.x);
  metal = 0.0;
}
`;

/**
 * sub_coating (extra): the boat's anechoic tile coating — 0.3 m rubber tiles (5 per 1.5 m tile) in 4 mm glue seams,
 * each slightly domed; one in a dozen a replacement from another batch; a few tiles with a corner torn off to the
 * red-brown anti-fouling under it; salt bloom along the seams and running down; damp patches glossier.
 */
export const SUB_COATING = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  vec2 cell = floor(m / 0.3); vec2 q = m - (cell + 0.5) * 0.3;
  vec3 hh = h3(ivec2(mod(cell, uTile / 0.3)), 3.0);
  float d = sdBox(q, vec2(0.148), 0.012);
  float body = 1.0 - smoothstep(-0.001, 0.001, d);
  float h = 0.2 + body * (0.42 + 0.12 * roundBevel(d, 0.01) + 0.06 * (1.0 - dot(q, q) / 0.0225));
  // torn corner
  vec2 cor = sign(hh.xy - 0.5) * 0.12;
  float torn = step(hh.z, 0.05) * (1.0 - smoothstep(0.035, 0.05 + 0.02 * fbm(uv, vec2(30.0), 3, 0.5, 4.0), length(q - cor)));
  h = mix(h, 0.18, torn * body);
  h += 0.012 * gnoise(uv * 400.0, vec2(400.0), 5.0) * body;
  return vec4(h, 1.0 - body, hh.z, torn * body);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float seam = H.g, id = H.b, torn = H.a;
  float mott = fbm01(uv, vec2(3.0), 4, 0.5, 11.0);
  vec3 c = uCol * (0.97 + 0.06 * (fract(id * 13.0) - 0.5) + 0.04 * (mott - 0.5));
  c = mix(c, uCol * vec3(1.1, 1.12, 1.16), step(0.9, id));
  rough = 0.8 + 0.06 * mott;
  // salt along the seams, and in streaks running down from them
  float st = streakNoise(uv, 40.0, 3.0, 12.0);
  float salt = sat(seam * 0.9 + smoothstep(0.58, 0.78, st) * 0.6 + (1.0 - D.x) * 0.8) * smoothstep(0.2, 0.5, fbm01(uv, vec2(6.0), 4, 0.5, 13.0));
  c = mix(c, C(0xb9bab2), salt * 0.55); rough = mix(rough, 0.95, salt * 0.6);
  // damp patches
  float damp = smoothstep(0.6, 0.78, fbm01(uv, vec2(2.0, 5.0), 4, 0.5, 14.0)) * (1.0 - salt);
  rough = mix(rough, 0.22, damp * 0.8); c *= 1.0 - damp * 0.08;
  c = mix(c, mix(C(0x7a3424), C(0x5e2a1e), mott), torn);
  rough = mix(rough, 0.7, torn);
  albedo = c * mix(0.78, 1.0, D.x);
  metal = 0.0;
}
`;

/** lino_navy (extra): barracks sheet linoleum (plain battleship lino, a faint jaspé along V), 2 m sheets with a weld rod at x 0, waxed, boot-scuffed. */
export const LINO_NAVY = /* glsl */ `
uniform vec3 uCol; uniform vec3 uCol2;
vec4 heightFn(vec2 uv) {
  float h = 0.5 + 0.012 * fbm(uv, vec2(2.0), 3, 0.5, 1.0);
  float seam = 1.0 - smoothstep(0.002, 0.003, min(uv.x, 1.0 - uv.x) * uTile);
  h -= 0.25 * seam;
  float scr = scratches(uv, 6.0, 0.2, 3.0, 0.1, 0.5, 1.0, 0.3, 2.0);
  h -= 0.1 * scr;
  return vec4(h, seam, scr, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  // plain battleship lino: a faint fine jaspé only (a strong figure read as wood grain — and there is no wood here)
  float j = streakNoise(uv, 200.0, 24.0, 4.0);
  vec3 c = mix(uCol2, uCol, 0.82 + 0.18 * smoothstep(0.3, 0.7, j));
  c *= 0.985 + 0.03 * fbm01(uv, vec2(6.0), 3, 0.5, 5.0);
  c = mix(c, uCol * 0.78, H.g);
  float heel = smoothstep(0.1, 0.5, H.b) * step(0.45, fbm01(uv, vec2(3.0), 3, 0.5, 6.0));
  c = mix(c, C(0x2a2a29), heel * 0.55);
  float lane = smoothstep(0.45, 0.85, fbm01(uv, vec2(2.0), 4, 0.5, 7.0));
  c *= 1.0 - 0.05 * lane;
  albedo = c * mix(0.86, 1.0, D.x);
  rough = 0.3 + 0.2 * lane + 0.2 * H.g; metal = 0.0;
}
`;

/** blanket_wool (extra): grey issue blanket — felted, heathered wool over a faint 2/2 twill, pilled. */
export const BLANKET = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float tw = sin((uv.x + uv.y) * 250.0 * PI) * 0.5 + 0.5;
  float felt = fbm(uv, vec2(40.0), 4, 0.6, 1.0);
  float pill = smoothstep(0.3, 0.1, worley(uv * 70.0, vec2(70.0), 4.0).x) * step(0.6, worley(uv * 70.0, vec2(70.0), 4.0).z);
  float h = 0.5 + 0.06 * tw + 0.14 * felt + 0.18 * pill + 0.1 * fbm(uv, vec2(2.0), 3, 0.5, 2.0);
  return vec4(h, tw, pill, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float heather = vnoise(uv * vec2(260.0, 30.0), vec2(260.0, 30.0), 11.0) * 0.5 + vnoise(uv * vec2(30.0, 260.0), vec2(30.0, 260.0), 12.0) * 0.5;
  vec3 c = uCol * (0.84 + 0.3 * heather);
  float fleck = smoothstep(0.88, 0.96, vnoise(uv * 300.0, vec2(300.0), 13.0));
  c = mix(c, C(0x2c3038), fleck * 0.5);
  c = mix(c, uCol * 1.12, H.b * 0.3);
  albedo = c * mix(0.7, 1.0, D.x);
  rough = 0.95; metal = 0.0;
}
`;

/**
 * hazard_deck (extra): yellow / black 45° deck stripes (88 mm bands, 0.25 m period along x + y) in grit paint, worn
 * through by boots in the traffic lane to grey primer and polished steel; black rubber scuffs.
 */
export const HAZARD_DECK = /* glsl */ `
uniform vec3 uColA; uniform vec3 uColB;
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float N = floor(uTile * 160.0);
  vec3 w = worley(uv * N, vec2(N), 1.0);
  float grit = dome(w.x, 0.55) * (0.5 + 0.5 * w.z);
  float wear = smoothstep(0.35, 0.85, fbm01(uv, vec2(1.0, 3.0), 4, 0.5, 2.0));
  float h = 0.4 + 0.3 * grit * (1.0 - 0.7 * wear) + 0.03 * fbm(uv, vec2(4.0), 3, 0.5, 3.0);
  float scr = scratches(uv, 8.0, 1.57, 1.0, 0.2, 1.0, 1.4, 0.4, 5.0);
  h -= 0.05 * scr;
  return vec4(h, grit, wear, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float f = fract((m.x + m.y) / 0.25);
  float yel = smoothstep(0.0, 0.004, f) * (1.0 - smoothstep(0.5, 0.504, f));
  float mott = fbm01(uv, vec2(5.0), 4, 0.5, 11.0);
  vec3 c = mix(uColB, uColA, yel) * (0.94 + 0.1 * mott);
  float wear = H.b;
  // through the topcoat: grey primer, and in the hardest lane bare polished steel
  float thru = smoothstep(0.6, 0.72, wear * 0.75 + 0.55 * fbm01(uv, vec2(48.0, 12.0), 4, 0.6, 12.0));
  float bare = smoothstep(0.78, 0.86, wear * 0.7 + 0.5 * fbm01(uv, vec2(64.0, 16.0), 3, 0.5, 13.0)) * thru;
  c = mix(c, C(0x707370), thru * 0.85);
  c = mix(c, C(0x9a9c9c), bare);
  float tip = smoothstep(0.5, 0.9, H.g) * (0.3 + 0.7 * wear);
  c = mix(c, c * 1.25 + 0.03, tip * 0.4);
  rough = mix(0.78, 0.6, wear); rough = mix(rough, 0.35, bare);
  metal = bare * 0.8;
  float heel = smoothstep(0.1, 0.6, H.a);
  c = mix(c, C(0x232323), heel * 0.5);
  float g = grimeAmount(uv, D, 0.4, 19.0);
  c = mix(c, C(0x2a2a28), g * 0.4);
  albedo = c * mix(0.8, 1.0, D.x);
}
`;
