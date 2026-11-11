/** Floor material shaders. */

export const FLOOR_PLATE = /* glsl */ `
// 1 m tile: one tread plate (lentil / diamond pattern, 32 per metre) with countersunk bolts on corners + mids.
float lentil(vec2 c, float ang) {
  float ca = cos(ang), sa = sin(ang);
  vec2 r = vec2(ca * c.x + sa * c.y, -sa * c.x + ca * c.y);
  float e = length(r / vec2(0.37, 0.095));
  return e;
}
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  vec2 p = m * 32.0;
  vec2 c1 = fract(p) - 0.5;
  vec2 c2 = fract(p + 0.5) - 0.5;
  float e1 = lentil(c1, 0.785398), e2 = lentil(c2, -0.785398);
  float e = min(e1, e2);
  float bump = sqrt(max(0.0, 1.0 - e * e)); // ellipsoidal cap
  bump = smoothstep(0.0, 0.35, bump) * (0.6 + 0.4 * bump);
  // plate edges + bolts
  vec2 em = min(m, 1.0 - m); float dEdge = min(em.x, em.y);
  vec2 bq = m - floor(m * 2.0 + 0.5) * 0.5; float bd = length(bq);
  float clear = smoothstep(0.03, 0.04, bd) * smoothstep(0.012, 0.02, dEdge);
  float h = 0.3 + 0.45 * bump * clear;
  h -= 0.2 * (1.0 - smoothstep(0.0, 0.003, dEdge)); // seam gap
  // countersunk bolt: cone + slot
  float cs = 1.0 - smoothstep(0.009, 0.0115, bd);
  float slot = step(abs(bq.x - bq.y) * 0.707, 0.0012) * step(bd, 0.008);
  h -= cs * (0.12 * (1.0 - bd / 0.0115)) + slot * 0.12;
  h += 0.02 * fbm(uv, vec2(5.0), 4, 0.5, 3.0);
  float dent = smoothstep(0.75, 1.0, fbm01(uv, vec2(9.0), 3, 0.5, 4.0));
  h -= 0.06 * dent;
  float scr = scratches(uv, 10.0, 0.4, 3.0, 0.2, 0.9, 1.4, 0.6, 5.0);
  h -= 0.02 * scr;
  h += 0.004 * gnoise(uv * 320.0, vec2(320.0), 6.0);
  return vec4(h, bump * clear, cs, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float bump = H.g; float scr = H.a;
  float mott = fbm01(uv, vec2(4.0), 5, 0.5, 11.0);
  float traffic = fbm01(uv, vec2(2.0), 3, 0.5, 12.0);
  vec3 steel = vec3(0.36, 0.37, 0.38) * (0.75 + 0.4 * mott);
  albedo = steel; metal = 1.0;
  rough = 0.48 + 0.2 * mott - 0.12 * traffic;
  // polished lentil tops (foot traffic)
  float top = smoothstep(0.35, 0.8, bump) * edgeMask(D, -0.05, 0.25);
  albedo = mix(albedo, vec3(0.62, 0.63, 0.64), top * (0.4 + 0.5 * traffic));
  rough = mix(rough, 0.2, top * (0.5 + 0.4 * traffic));
  // scratches: bright
  float sc = smoothstep(0.1, 0.7, scr);
  albedo = mix(albedo, vec3(0.6), sc * 0.5); rough = mix(rough, 0.25, sc * 0.5);
  // valley dirt
  float g = grimeAmount(uv, D, uGrime * 0.6, 19.0) + (1.0 - bump) * 0.25 * smoothstep(0.4, 0.8, fbm01(uv, vec2(16.0), 5, 0.6, 13.0));
  g = sat(g);
  vec3 dirt = mix(C(0x241f19), C(0x40372c), fbm01(uv, vec2(30.0), 3, 0.5, 14.0));
  albedo = mix(albedo, dirt, g * 0.7); rough = mix(rough, 0.8, g * 0.8); metal *= 1.0 - g * 0.8;
  // rust spots (mostly in the valleys)
  float rn = fbm01(uv, vec2(12.0), 6, 0.6, 15.0);
  float rust = smoothstep(0.7, 0.85, rn) * (0.3 + 0.7 * (1.0 - bump));
  vec3 rustC = mix(C(0x3a2214), C(0x6a3c20), fbm01(uv, vec2(80.0), 3, 0.5, 16.0));
  albedo = mix(albedo, rustC, rust * 0.8); rough = mix(rough, 0.9, rust); metal *= 1.0 - rust;
  // oil stains + puddles: dark, glossy
  float oil = smoothstep(0.7, 0.85, warped(uv, vec2(5.0), 5, 1.5, 17.0) * 0.5 + 0.5);
  albedo = mix(albedo, albedo * 0.6, oil * 0.5); rough = mix(rough, 0.2, oil * 0.5);
  float wet = smoothstep(0.62, 0.8, fbm01(uv, vec2(8.0), 5, 0.6, 18.0)) * (1.0 - bump * 0.7);
  albedo *= 1.0 - wet * 0.15; rough = mix(rough, 0.15, wet * 0.6);
  albedo *= 0.85 + 0.25 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  albedo *= mix(0.6, 1.0, D.x);
}
`;

export const FLOOR_GRATE = /* glsl */ `
// 1 m tile: bar grating. Bearing bars run along v (32 per metre, 5 mm), twisted cross bars every 10 cm,
// perimeter band. Alpha = 0 in the openings.
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float bx = abs(fract(m.x * 32.0) - 0.5) / 32.0;        // metres from bearing bar centre
  float cy = abs(fract(m.y * 10.0) - 0.5) / 10.0;        // metres from cross bar centre
  float bandD = min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y));
  float bear = 1.0 - smoothstep(0.0026, 0.0032, bx);
  float cross = 1.0 - smoothstep(0.0028, 0.0034, cy);
  float band = 1.0 - smoothstep(0.0045, 0.0052, bandD);
  float h = 0.0;
  // bearing bar top: rounded + serrated
  float serr = smoothstep(0.2, 0.5, abs(fract(m.y * 90.0) - 0.5) * 2.0);
  float hb = 0.85 + 0.15 * dome(bx, 0.0032) - 0.12 * (1.0 - serr);
  // twisted cross bar: diagonal ridges
  float tw = 0.5 + 0.5 * sin((m.x * 32.0 * 2.0 + cy * 400.0) * 3.14159);
  float hc = 0.72 + 0.12 * dome(cy, 0.0034) + 0.06 * tw;
  float hd = 0.9 + 0.08 * dome(bandD - 0.0025, 0.0025);
  h = max(max(hb * bear, hc * cross), hd * band);
  float a = max(max(bear, cross), band);
  h += 0.03 * fbm(uv, vec2(8.0), 3, 0.5, 4.0) * a;
  return vec4(h, a, bear + band, cross);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float a = H.g;
  float mott = fbm01(uv, vec2(6.0), 5, 0.5, 11.0);
  // galvanised: zinc spangle variation
  vec3 w = worley(uv * 60.0, vec2(60.0), 12.0);
  vec3 zinc = vec3(0.4, 0.41, 0.42) * (0.8 + 0.25 * w.z) * (0.8 + 0.35 * mott);
  albedo = zinc; metal = 0.95; rough = 0.42 + 0.2 * w.z + 0.15 * mott;
  float ew = edgeMask(D, 0.05, 0.3);
  albedo = mix(albedo, vec3(0.62), ew * 0.4); rough = mix(rough, 0.25, ew * 0.4);
  float g = sat(smoothstep(0.4, 0.85, fbm01(uv, vec2(5.0), 5, 0.5, 13.0)) * 0.9 + (1.0 - D.x) * 1.5);
  vec3 dirt = mix(C(0x14110e), C(0x3b3127), fbm01(uv, vec2(40.0), 3, 0.5, 14.0));
  albedo = mix(albedo, dirt, g * 0.8); rough = mix(rough, 0.85, g * 0.8); metal *= 1.0 - g * 0.85;
  float rust = smoothstep(0.62, 0.8, fbm01(uv, vec2(9.0), 5, 0.55, 15.0));
  albedo = mix(albedo, mix(C(0x3d1f10), C(0x7a4020), mott), rust * 0.8); rough = mix(rough, 0.9, rust); metal *= 1.0 - rust;
  float oil = smoothstep(0.65, 0.75, fbm01(uv, vec2(3.0), 5, 0.55, 16.0));
  albedo *= 1.0 - oil * 0.5; rough = mix(rough, 0.12, oil * 0.8);
  albedo *= 0.85 + 0.25 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  alpha = smoothstep(0.35, 0.65, a);
}
`;

export const FLOOR_RUBBER = /* glsl */ `
// 1 m tile: round-stud rubber floor, 5 cm pitch, 28 mm studs.
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  vec2 q = (fract(m * 20.0) - 0.5) / 20.0;
  float d = length(q) - 0.014;
  float stud = roundBevel(d, 0.0025);
  float h = 0.25 + 0.6 * stud;
  // moulded ring around stud base
  h += 0.04 * dome(abs(d - 0.0015), 0.0015) * (1.0 - stud);
  // fine moulding grain / wear
  h += 0.035 * gnoise(uv * 300.0, vec2(300.0), 3.0) + 0.02 * gnoise(uv * 700.0, vec2(700.0), 4.0);
  h += 0.04 * fbm(uv, vec2(6.0), 4, 0.5, 5.0);
  float scuff = scratches(uv, 12.0, 0.3, 3.0, 0.2, 0.8, 1.6, 0.6, 6.0);
  h -= 0.08 * scuff * stud;
  return vec4(h, stud, scuff, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float stud = H.g; float scuff = H.b;
  float mott = fbm01(uv, vec2(5.0), 5, 0.5, 11.0);
  albedo = uBase * (0.85 + 0.3 * mott);
  rough = 0.78 + 0.1 * mott; metal = 0.0;
  float traffic = fbm01(uv, vec2(2.0), 3, 0.5, 12.0);
  // worn, slightly polished stud tops
  rough = mix(rough, 0.5, stud * traffic * 0.8);
  albedo = mix(albedo, albedo * 1.25, stud * traffic * 0.4);
  // pale dust in the gaps
  float dust = (1.0 - stud) * smoothstep(0.3, 0.8, fbm01(uv, vec2(12.0), 4, 0.5, 13.0));
  dust = max(dust, grimeAmount(uv, D, 0.7, 14.0) * 0.6);
  albedo = mix(albedo, C(0x4a4640), dust * 0.6); rough = mix(rough, 0.95, dust);
  // black heel scuffs
  albedo = mix(albedo, albedo * 0.6, smoothstep(0.1, 0.6, scuff));
  // spills: glossy
  float wet = smoothstep(0.64, 0.72, warped(uv, vec2(5.0), 5, 1.2, 15.0) * 0.5 + 0.5);
  rough = mix(rough, 0.12, wet); albedo *= 1.0 - wet * 0.35;
  albedo *= 0.85 + 0.25 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  albedo *= mix(0.65, 1.0, D.x);
}
`;

export const FLOOR_CONCRETE = /* glsl */ `
// 3 m tile: sealed industrial concrete slab, saw-cut joints on the tile edges.
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float h = 0.5;
  h += 0.05 * fbm(uv, vec2(3.0), 7, 0.55, 1.0);
  // exposed fine aggregate where the surface is worn: irregular, multi-size, low relief
  vec3 ag = worley(uv * 150.0, vec2(150.0), 2.0);
  float worn = smoothstep(0.5, 0.8, fbm01(uv, vec2(4.0), 5, 0.55, 3.0));
  float stone = smoothstep(0.42, 0.2, ag.x + 0.15 * gnoise(uv * 600.0, vec2(600.0), 33.0)) * step(0.6, ag.z);
  h += 0.015 * stone * worn;
  // pores / pinholes
  vec3 po = worley(uv * 260.0, vec2(260.0), 4.0);
  float pore = smoothstep(0.2, 0.06, po.x) * step(0.86, po.z);
  h -= 0.1 * pore;
  // cracks: voronoi borders, jagged, only along selected cells
  vec2 jag = vec2(gnoise(uv * 90.0, vec2(90.0), 5.0), gnoise(uv * 90.0, vec2(90.0), 6.0)) * 0.006
           + vec2(fbm(uv, vec2(10.0), 3, 0.5, 15.0), fbm(uv, vec2(10.0), 3, 0.5, 16.0)) * 0.009;
  vec3 ve = voronoiEdge((uv + jag) * 4.0, vec2(4.0), 7.0, 1.0);
  float crackSel = smoothstep(0.55, 0.62, fbm01(uv, vec2(5.0), 4, 0.5, 8.0));
  float cw = 0.0018 + 0.0022 * fbm01(uv, vec2(30.0), 3, 0.5, 9.0);
  float crack = (1.0 - smoothstep(0.0, cw, ve.x)) * crackSel;
  float crackEdge = (1.0 - smoothstep(cw, cw * 4.0, ve.x)) * crackSel;
  h -= 0.3 * crack + 0.03 * crackEdge;
  // saw-cut joints
  float jd = min(min(m.x, uTile - m.x), min(m.y, uTile - m.y));
  float joint = 1.0 - smoothstep(0.003, 0.005, jd);
  float jEdge = 1.0 - smoothstep(0.005, 0.02, jd);
  h -= 0.4 * joint + 0.04 * jEdge * fbm01(uv, vec2(80.0), 3, 0.5, 12.0);
  h += 0.006 * gnoise(uv * 512.0, vec2(512.0), 13.0);
  return vec4(h, sat(crack + joint), stone * worn, sat(crackEdge + jEdge));
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float crack = H.g; float stone = H.b;
  float n1 = fbm01(uv, vec2(2.0), 7, 0.55, 20.0);
  float n2 = fbm01(uv, vec2(12.0), 5, 0.55, 21.0);
  float n3 = fbm01(uv, vec2(60.0), 3, 0.5, 22.0);
  vec3 base = mix(C(0x48463f), C(0x6e6a62), n1);
  base *= 0.9 + 0.14 * n2 + 0.08 * (n3 - 0.5);
  // power-trowel swirls: faint burnished arcs
  vec2 tq = fract(uv * 3.0) - 0.5;
  float trowel = 0.5 + 0.5 * sin(length(tq) * 70.0 + atan(tq.y, tq.x) * 2.0 + n2 * 8.0);
  albedo = base * (0.985 + 0.025 * trowel * n2);
  albedo = mix(albedo, C(0x77736a) * (0.85 + 0.3 * n3), stone * 0.15);
  metal = 0.0;
  // sealer: patchy satin, worn matte in traffic
  float seal = fbm01(uv, vec2(3.0), 6, 0.55, 23.0);
  rough = mix(0.42, 0.82, smoothstep(0.3, 0.7, seal)) - 0.03 * trowel * n2;
  // cracks + joints: dirt-filled, edges slightly spalled & darker
  albedo = mix(albedo, C(0x1b1916), crack * 0.9); rough = mix(rough, 0.95, crack);
  albedo *= 1.0 - 0.15 * H.a;
  float g = grimeAmount(uv, D, uGrime, 24.0);
  albedo = mix(albedo, C(0x2a2620), g * 0.5);
  // oil stains: dark, smooth, soft edges with a darker rim
  float o = warped(uv, vec2(3.0), 6, 2.0, 25.0) * 0.5 + 0.5;
  float oil = smoothstep(0.6, 0.8, o);
  float rim = smoothstep(0.6, 0.66, o) * (1.0 - smoothstep(0.66, 0.74, o));
  albedo = mix(albedo, albedo * 0.5, oil * 0.55 + rim * 0.12); rough = mix(rough, 0.35, oil * 0.6);
  // faint rust stains
  float rs = smoothstep(0.74, 0.86, fbm01(uv, vec2(6.0), 6, 0.6, 26.0));
  albedo = mix(albedo, C(0x5a4030) * (0.7 + 0.5 * n2), rs * 0.35);
  // efflorescence / dried water tide marks — soft, low contrast
  vec3 w = worley(uv * 3.0, vec2(3.0), 27.0);
  float tideD = abs(w.x - 0.42 - 0.08 * fbm(uv, vec2(12.0), 4, 0.5, 28.0));
  float tide = smoothstep(0.03, 0.0, tideD) * step(0.7, w.z) * (0.5 + 0.5 * n3);
  albedo = mix(albedo, albedo * 1.2 + 0.02, tide * 0.35);
  // puddles: very smooth + darker
  float puddle = smoothstep(0.66, 0.76, fbm01(uv, vec2(3.0), 6, 0.6, 29.0));
  albedo *= 1.0 - puddle * 0.2; rough = mix(rough, 0.06, puddle * 0.9);
  albedo *= mix(0.75, 1.0, D.x);
}
`;
