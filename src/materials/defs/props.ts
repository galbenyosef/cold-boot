/** Generic prop surfaces: painted metal family, bare-metal family, polymer family, rust, fabric, glass. */

/**
 * Painted steel (painted_*, hazard_stripes). Uniforms:
 *  uColA / uColB (stripe colours, B used only when uStripe > 0), uWear (chip amount), uPaintRough, uGrime.
 */
export const PAINTED = /* glsl */ `
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float h = 0.5;
  h += 0.03 * fbm(uv, vec2(4.0), 4, 0.5, 1.0);
  float dent = smoothstep(0.72, 1.0, fbm01(uv, vec2(7.0), 3, 0.5, 2.0));
  h -= 0.08 * dent;
  // stripes add their own paint edge wear (traffic) — more chips at stripe borders
  float stripe = 0.0, sEdge = 0.0;
  if (uStripe > 0.5) {
    float t = fract((m.x + m.y) * 4.0 / uTile * uTile);
    stripe = step(0.5, t);
    sEdge = 1.0 - smoothstep(0.0, 0.04, min(abs(t - 0.5), min(t, 1.0 - t)));
  }
  float wearN = fbm01(uv, vec2(2.0), 3, 0.5, 3.0);
  vec2 chip = chipMask(uv, 9.0, sEdge * 0.3 + wearN * 0.1, -0.17 + uWear * 0.14, 4.0);
  float s1 = scratches(uv, 8.0, 0.3, 3.0, 0.2, 1.1, 1.0, 0.3, 5.0);
  float s2 = scratches(uv, 14.0, 1.2, 0.8, 0.1, 0.5, 0.8, 0.3 * uWear + 0.1, 6.0);
  float scr = max(s1, s2);
  h += 0.012 * (1.0 - chip.y) + 0.02 * (1.0 - chip.x);
  h -= 0.02 * scr;
  h += uPeel * gnoise(uv * 200.0, vec2(200.0), 9.0) + uPeel * 0.5 * gnoise(uv * 520.0, vec2(520.0), 10.0);
  float state = (1.0 - chip.x) * 0.5 + (1.0 - chip.y) * 0.5;
  return vec4(h, state, stripe, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float state = H.g; float scr = H.a;
  float mott = fbm01(uv, vec2(5.0), 5, 0.5, 11.0);
  vec3 paint = mix(uColA, uColB, H.b) * (0.88 + 0.24 * mott);
  float fade = fbm01(uv, vec2(2.0), 3, 0.5, 12.0);
  paint = mix(paint, vec3(luma(paint)) * 1.1 + 0.02, fade * 0.18);
  vec3 primer = C(0x5a3a2c);
  vec3 bare = vec3(0.5, 0.51, 0.52) * (0.8 + 0.3 * fbm01(uv, vec2(50.0, 8.0), 3, 0.5, 13.0));
  float isPaint = smoothstep(0.7, 0.95, state);
  float isPrimer = smoothstep(0.25, 0.45, state) * (1.0 - isPaint);
  float isMetal = 1.0 - isPaint - isPrimer;
  albedo = paint * isPaint + primer * isPrimer + bare * isMetal;
  rough = (uPaintRough + 0.15 * mott) * isPaint + 0.75 * isPrimer + 0.3 * isMetal;
  metal = isMetal;
  float sc = smoothstep(0.1, 0.6, scr) * isPaint;
  albedo = mix(albedo, mix(paint * 0.7, bare, 0.6), sc * 0.85); metal = max(metal, sc * 0.7); rough = mix(rough, 0.3, sc * 0.7);
  float rustN = fbm01(uv, vec2(14.0), 5, 0.55, 17.0);
  float rustM = isMetal * smoothstep(0.4, 0.7, rustN);
  albedo = mix(albedo, mix(C(0x3e1f10), C(0x84461f), rustN), rustM * 0.8); rough = mix(rough, 0.85, rustM); metal *= 1.0 - rustM;
  float g = grimeAmount(uv, D, uGrime, 19.0);
  g = max(g, smoothstep(0.6, 0.95, fbm01(uv, vec2(10.0), 6, 0.6, 20.0)) * uGrime * 0.35);
  vec3 grimeC = mix(C(0x15120e), C(0x3a3024), fbm01(uv, vec2(24.0), 3, 0.5, 21.0));
  albedo = mix(albedo, grimeC, g * 0.75); rough = mix(rough, 0.85, g * 0.7); metal *= 1.0 - g;
  float oil = smoothstep(0.7, 0.8, warped(uv, vec2(6.0), 5, 1.5, 22.0) * 0.5 + 0.5) * uGrime;
  albedo = mix(albedo, albedo * 0.55, oil * 0.5); rough = mix(rough, 0.18, oil * 0.6);
  float st = streakNoise(uv, 30.0, 2.0, 23.0) * fbm01(uv, vec2(2.0), 3, 0.5, 24.0);
  albedo *= 1.0 - 0.25 * smoothstep(0.3, 0.65, st) * uGrime;
  albedo *= 0.85 + 0.25 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  albedo *= mix(0.7, 1.0, D.x);
}
`;

/**
 * Bare metals: trim_steel, steel_raw, chrome, gunmetal, copper, brass, robot_frame, robot_joint.
 * uCol base albedo, uCol2 tarnish/oxide, uRough (min,max), uBrush (strength, dir 0=u 1=v), uScratch,
 * uOxide, uPatina (copper green), uOil, uGrime, uMachine (fine machining ridges).
 */
export const METAL = /* glsl */ `
vec4 heightFn(vec2 uv) {
  vec2 suv = uBrush.y > 0.5 ? uv.yx : uv;
  float brush = streakNoise(suv, 3.0, 700.0, 1.0) * 0.6 + gnoise(suv * vec2(8.0, 1400.0), vec2(8.0, 1400.0), 2.0) * 0.4;
  float h = 0.5 + uBrush.x * 0.05 * brush;
  // machining ridges (fine parallel)
  h += uMachine * 0.03 * sin(suv.y * uRes.y * 0.25 * TAU);
  h += 0.04 * fbm(uv, vec2(4.0), 4, 0.5, 3.0);
  float s1 = scratches(uv, 10.0, uBrush.y > 0.5 ? 1.57 : 0.0, 0.25, 0.3, 1.5, 1.0, 0.7 * uScratch, 4.0);
  float s2 = scratches(uv, 18.0, 0.8, 3.2, 0.1, 0.7, 0.8, 0.8 * uScratch, 5.0);
  float s3 = scratches(uv, 6.0, 2.2, 3.2, 0.3, 1.2, 1.8, 0.4 * uScratch, 6.0);
  float scr = max(max(s1, s2 * 0.8), s3);
  h -= 0.05 * scr;
  // pitting / oxide bumps
  vec3 w = worley(uv * 90.0, vec2(90.0), 7.0);
  float pit = smoothstep(0.25, 0.05, w.x) * step(1.0 - 0.25 * uOxide, w.z);
  h -= 0.08 * pit;
  float ox = smoothstep(0.55, 0.85, fbm01(uv, vec2(6.0), 6, 0.55, 8.0)) * uOxide;
  h += 0.03 * ox * fbm01(uv, vec2(60.0), 3, 0.5, 9.0);
  return vec4(h, scr, ox, pit);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 suv = uBrush.y > 0.5 ? uv.yx : uv;
  float scr = H.g; float ox = H.b;
  float mott = fbm01(uv, vec2(4.0), 5, 0.55, 11.0);
  float bstreak = streakNoise(suv, 6.0, 300.0, 12.0) * 0.6 + 0.4 * (0.5 + 0.5 * gnoise(suv * vec2(4.0, 900.0), vec2(4.0, 900.0), 13.0));
  float fineN = fbm01(uv, vec2(16.0), 4, 0.5, 14.0);
  albedo = uCol * (0.9 + 0.12 * mott + 0.08 * (fineN - 0.5)) * (1.0 + uBrush.x * 0.3 * (bstreak - 0.5));
  rough = mix(uRough.x, uRough.y, 0.35 * mott + 0.65 * fineN) + uBrush.x * 0.16 * (bstreak - 0.5);
  metal = uMetal;
  // scratches: brighter, slightly rougher across the brush direction
  float sc = smoothstep(0.1, 0.7, scr);
  albedo = mix(albedo, max(albedo, uScratchCol), sc * 0.7);
  rough = mix(rough, uRough.x + 0.1, sc * 0.6);
  // tarnish / oxide
  float tarn = smoothstep(0.5, 0.85, fbm01(uv, vec2(6.0), 6, 0.6, 13.0)) * uOxide;
  albedo = mix(albedo, uCol2, tarn * 0.7);
  rough = mix(rough, uRough.y + 0.1, tarn * 0.6);
  albedo = mix(albedo, uCol2 * 0.8, ox * 0.6);
  // copper patina (dielectric, green-cyan) in cavities + drip streaks
  float pat = uPatina * sat(smoothstep(0.55, 0.8, fbm01(uv, vec2(5.0), 6, 0.55, 14.0)) + cavityMask(D, 0.0, 0.08) * 0.8
              + smoothstep(0.6, 0.9, streakNoise(uv, 30.0, 3.0, 15.0)) * 0.5);
  vec3 patC = mix(C(0x3f7a66), C(0x7ab8a0), fbm01(uv, vec2(40.0), 3, 0.5, 16.0));
  albedo = mix(albedo, patC, pat); rough = mix(rough, 0.9, pat); metal *= 1.0 - pat;
  // oil film: darker, smoother, rainbow-free; plus black oily grime build-up
  float oil = uOil * smoothstep(0.55, 0.75, warped(uv, vec2(8.0), 5, 1.5, 17.0) * 0.5 + 0.5);
  albedo *= 1.0 - oil * 0.35; rough = mix(rough, 0.08, oil * 0.8);
  float g = grimeAmount(uv, D, uGrime, 19.0);
  g = max(g, uOil * 0.6 * smoothstep(0.62, 0.85, fbm01(uv, vec2(12.0), 5, 0.6, 18.0)));
  albedo = mix(albedo, C(0x0c0b0a), g * 0.85); rough = mix(rough, mix(0.85, 0.35, uOil), g * 0.8); metal *= 1.0 - g * 0.9;
  // fingerprints / smudges on polished
  float smd = smudges(uv, 5.0, 20.0) * uSmudge;
  rough = mix(rough, rough + 0.25, smd); albedo *= 1.0 - smd * 0.08;
  // edges brighter
  float ew = edgeMask(D, 0.05, 0.3);
  albedo = mix(albedo, max(albedo, uScratchCol), ew * 0.4); rough = mix(rough, uRough.x, ew * 0.4);
  albedo *= 0.88 + 0.2 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
}
`;

/** Polymers: rubber, plastic_dark, plastic_white, screen_off. uCol, uRough (min,max), uGrain, uScuff, uDust, uYellow. */
export const POLY = /* glsl */ `
vec4 heightFn(vec2 uv) {
  float h = 0.5;
  // sand-blasted / moulded grain
  h += uGrain * (0.5 * gnoise(uv * 400.0, vec2(400.0), 1.0) + 0.35 * gnoise(uv * 900.0, vec2(900.0), 2.0));
  h += 0.05 * fbm(uv, vec2(4.0), 4, 0.5, 3.0);
  float s1 = scratches(uv, 12.0, 0.4, 3.2, 0.1, 0.8, 1.1, 0.6 * uScuff, 4.0);
  float s2 = scratches(uv, 5.0, 0.4, 3.2, 0.2, 1.0, 2.5, 0.3 * uScuff, 5.0);
  float scr = max(s1, s2);
  h -= 0.1 * scr;
  float dent = smoothstep(0.75, 1.0, fbm01(uv, vec2(8.0), 3, 0.5, 6.0));
  h -= 0.06 * dent;
  return vec4(h, scr, 0.0, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float scr = H.g;
  float mott = fbm01(uv, vec2(4.0), 5, 0.5, 11.0);
  albedo = uCol * (0.9 + 0.2 * mott);
  rough = mix(uRough.x, uRough.y, fbm01(uv, vec2(6.0), 5, 0.55, 12.0));
  metal = 0.0;
  // stress-whitened scratches on dark plastic, darker on white
  float sc = smoothstep(0.1, 0.7, scr);
  vec3 scC = luma(uCol) < 0.3 ? albedo * 1.8 + 0.06 : albedo * 0.78;
  albedo = mix(albedo, scC, sc * 0.7); rough = mix(rough, rough + 0.15, sc);
  // scuff patches (polished)
  float scuffP = smoothstep(0.62, 0.8, fbm01(uv, vec2(5.0, 12.0), 5, 0.55, 13.0)) * uScuff;
  rough = mix(rough, uRough.x * 0.7, scuffP * 0.7);
  albedo = mix(albedo, luma(uCol) < 0.3 ? albedo * 1.3 : albedo * 0.9, scuffP * 0.5);
  float dust = uDust * sat(smoothstep(0.45, 0.85, fbm01(uv, vec2(8.0), 5, 0.55, 14.0)) + (1.0 - D.x) * 1.5);
  albedo = mix(albedo, C(0x5a554c), dust * 0.45); rough = mix(rough, 0.95, dust * 0.8);
  float smd = smudges(uv, 5.0, 15.0) * uSmudge;
  rough = mix(rough, 0.45, smd * 0.8); albedo = mix(albedo, albedo + 0.02, smd);
  albedo = mix(albedo, albedo * vec3(1.0, 0.95, 0.8), uYellow * fbm01(uv, vec2(2.0), 4, 0.5, 16.0));
  float g = grimeAmount(uv, D, uGrime, 17.0);
  albedo = mix(albedo, C(0x1a1713), g * 0.6); rough = mix(rough, 0.85, g * 0.5);
  albedo *= 0.9 + 0.18 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
}
`;

export const RUST = /* glsl */ `
// heavy corrosion: flaking scale plates lifting off pitted metal, remnants of old dark paint
vec4 heightFn(vec2 uv) {
  float h = 0.45 + 0.12 * fbm(uv, vec2(4.0), 6, 0.55, 1.0);
  vec3 ve = voronoiEdge(uv * 18.0, vec2(18.0), 2.0, 1.0);
  float flake = smoothstep(0.0, 0.12, ve.x);
  float lift = smoothstep(0.4, 0.75, fbm01(uv, vec2(9.0), 4, 0.5, 3.0));
  h += 0.12 * flake * lift * (0.5 + ve.y) ;
  h += 0.18 * flake * lift * (1.0 - smoothstep(0.0, 0.25, ve.x)) * step(0.5, ve.y); // curled edges
  // pits
  vec3 w = worley(uv * 70.0, vec2(70.0), 4.0);
  h -= 0.18 * smoothstep(0.35, 0.05, w.x) * step(0.4, w.z);
  h += 0.06 * ridged(uv, vec2(16.0), 5, 5.0);
  h += 0.03 * gnoise(uv * 380.0, vec2(380.0), 6.0);
  float paint = smoothstep(0.72, 0.76, fbm01(uv, vec2(5.0), 6, 0.6, 7.0));
  h = mix(h, 0.7 + 0.02 * gnoise(uv * 200.0, vec2(200.0), 8.0), paint);
  return vec4(h, paint, flake * lift, ve.y);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float paint = H.g; float fl = H.b;
  float n1 = fbm01(uv, vec2(6.0), 6, 0.55, 11.0);
  float n2 = fbm01(uv, vec2(40.0), 4, 0.5, 12.0);
  vec3 dark = C(0x2a140a), mid = C(0x6b3416), hi = C(0xa2582a), yel = C(0xb57a3a);
  vec3 c = mix(dark, mid, smoothstep(0.2, 0.6, n1));
  c = mix(c, hi, smoothstep(0.55, 0.85, n2) * 0.8);
  c = mix(c, yel, smoothstep(0.75, 0.95, n1 * n2 * 1.6) * 0.5);
  c *= 0.8 + 0.4 * H.a * fl;
  albedo = c;
  rough = 0.82 + 0.15 * n2; metal = 0.05;
  // exposed metal in deep pits glints
  float pit = cavityMask(D, 0.05, 0.2);
  albedo = mix(albedo, C(0x1a0d06), pit * 0.7);
  // old paint remnant
  vec3 pc = C(0x2b3430) * (0.8 + 0.3 * n2);
  albedo = mix(albedo, pc, paint); rough = mix(rough, 0.6, paint);
  // rust bleeding over paint edges
  float bleed = paint * smoothstep(0.3, 0.8, streakNoise(uv, 40.0, 4.0, 13.0));
  albedo = mix(albedo, mid, bleed * 0.5);
  // damp patches darker + smoother
  float damp = smoothstep(0.6, 0.75, fbm01(uv, vec2(3.0), 5, 0.55, 14.0));
  albedo *= 1.0 - damp * 0.35; rough = mix(rough, 0.45, damp);
  albedo *= mix(0.6, 1.0, D.x);
}
`;

export const FABRIC = /* glsl */ `
// 0.25 m tile: plain weave, 2 mm threads; heathered fibres, stains, pilling.
vec4 heightFn(vec2 uv) {
  float n = 125.0;
  vec2 p = uv * n;
  vec2 c = floor(p); vec2 f = fract(p);
  float checker = mod(c.x + c.y, 2.0);
  // warp thread (along v) rises where checker = 1, weft (along u) elsewhere
  float warp = sin(f.x * PI); float weft = sin(f.y * PI);
  float wv = pow(warp, 0.6) * (0.55 + 0.45 * sin((f.y + checker) * PI));
  float wf = pow(weft, 0.6) * (0.55 + 0.45 * sin((f.x + 1.0 - checker) * PI));
  float h = max(wv, wf) * 0.8;
  float fib = gnoise(uv * vec2(n * 6.0, n * 0.7), vec2(n * 6.0, n * 0.7), 1.0) * (wv > wf ? 1.0 : 0.0)
            + gnoise(uv * vec2(n * 0.7, n * 6.0), vec2(n * 0.7, n * 6.0), 2.0) * (wv > wf ? 0.0 : 1.0);
  h += 0.08 * fib;
  h += 0.15 * fbm(uv, vec2(3.0), 4, 0.5, 3.0);
  float pill = smoothstep(0.3, 0.1, worley(uv * 60.0, vec2(60.0), 4.0).x) * 0.2;
  h += pill;
  return vec4(h, wv > wf ? 1.0 : 0.0, fib, pill);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float heather = vnoise(uv * vec2(125.0 * 3.0, 20.0), vec2(375.0, 20.0), 11.0);
  vec3 c = uCol * (0.8 + 0.35 * heather) * (H.g > 0.5 ? 1.0 : 0.88);
  c *= 0.85 + 0.3 * fbm01(uv, vec2(3.0), 4, 0.5, 12.0);
  // stains (body fluids / coffee / oil)
  float st = smoothstep(0.62, 0.72, warped(uv, vec2(2.0), 5, 1.5, 13.0) * 0.5 + 0.5);
  float ring = smoothstep(0.62, 0.65, warped(uv, vec2(2.0), 5, 1.5, 13.0) * 0.5 + 0.5) * (1.0 - st);
  c = mix(c, c * vec3(0.75, 0.68, 0.55), st * 0.6 + ring * 0.4);
  albedo = c * mix(0.55, 1.0, D.x);
  rough = 0.92 - st * 0.1; metal = 0.0;
}
`;

export const GLASS = /* glsl */ `
// transparent glass: albedo alpha carries dirt opacity; roughness carries smudges.
vec4 heightFn(vec2 uv) {
  float h = 0.5 + 0.02 * fbm(uv, vec2(2.0), 3, 0.5, 1.0);
  float scr = scratches(uv, 8.0, 0.2, 3.0, 0.1, 0.8, 0.8, 0.35, 2.0);
  h -= 0.1 * scr;
  return vec4(h, scr, 0.0, 0.0);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float smd = smudges(uv, 4.0, 11.0);
  float dirt = smoothstep(0.6, 0.98, fbm01(uv, vec2(8.0), 6, 0.6, 12.0)) * 0.7;
  float specks = step(0.93, worley(uv * 120.0, vec2(120.0), 13.0).z) * smoothstep(0.3, 0.1, worley(uv * 120.0, vec2(120.0), 13.0).x);
  // rain-like dried water streaks
  float st = smoothstep(0.55, 0.85, streakNoise(uv, 40.0, 3.0, 14.0)) * 0.5;
  albedo = mix(vec3(0.55, 0.6, 0.6), C(0x57534c), sat(dirt * 0.8 + specks));
  rough = 0.03 + 0.25 * smd + 0.4 * dirt + 0.2 * st + 0.3 * H.g;
  metal = 0.0;
  alpha = sat(0.08 + dirt * 0.3 + specks * 0.5 + smd * 0.05 + st * 0.06);
}
`;
