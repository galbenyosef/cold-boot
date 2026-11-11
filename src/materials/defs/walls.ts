/** Wall + ceiling material shaders. Coordinates: `m = uv * uTile` in metres, +y is up on walls. */

export const WALL_PANEL = /* glsl */ `
// 2 m tile: two 1 m columns; kick panel 0..0.7 m, tall panel 0.7..2.0 m.
void panelOf(vec2 m, out vec2 q, out vec2 hs, out vec2 id) {
  float col = floor(m.x);
  float y0 = m.y < 0.7 ? 0.0 : 0.7; float y1 = m.y < 0.7 ? 0.7 : 2.0;
  hs = vec2(0.5, (y1 - y0) * 0.5);
  q = m - vec2(col + 0.5, y0 + hs.y);
  id = vec2(col, y0);
}
float chipEdge;
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile; vec2 q, hs, id; panelOf(m, q, hs, id);
  float ph = h1(ivec2(id * 10.0), 3.0);
  float d = sdBox(q, hs - 0.004, 0.008);
  float h = 0.22 + 0.38 * roundBevel(d, 0.007);
  float inner = 0.0;
  if (hs.y > 0.4) {
    float di = sdBox(q, hs - vec2(0.085, 0.10), 0.035);
    inner = smoothstep(0.012, -0.012, di);
    h -= 0.09 * inner;
    // small riveted ID plate on the left column
    if (id.x < 0.5) {
      vec2 pq = q - vec2(-0.22, 0.38);
      float dp = sdBox(pq, vec2(0.085, 0.045), 0.006);
      h += 0.07 * roundBevel(dp, 0.003) * (1.0 - inner * 0.0);
      float pr = min(min(length(pq - vec2(-0.07, 0.03)), length(pq - vec2(0.07, 0.03))), min(length(pq - vec2(-0.07, -0.03)), length(pq - vec2(0.07, -0.03))));
      h += 0.05 * dome(pr, 0.004);
      // embossed bars ("text") on plate
      vec2 tq = pq - vec2(0.0, 0.004);
      float bars = step(abs(tq.y), 0.012) * step(abs(tq.x), 0.055) * step(0.35, fract(tq.x * 70.0 + floor(tq.y * 50.0) * 0.37)) * step(0.004, abs(tq.y));
      h += 0.012 * bars;
    }
  } else {
    float b = min(abs(q.y - 0.12), abs(q.y + 0.12));
    float inx = smoothstep(0.0, 0.03, hs.x - 0.09 - abs(q.x));
    h += 0.07 * dome(b, 0.02) * inx;
  }
  // gentle oil-canning / dents
  float panelMask = bevel(d, 0.04);
  h += 0.035 * fbm(uv + ph, vec2(4.0), 4, 0.5, 1.0) * panelMask;
  float dent = smoothstep(0.75, 1.0, fbm01(uv, vec2(10.0), 3, 0.5, 2.0));
  h -= 0.03 * dent * panelMask;
  // rivets
  float rd = rivetDist(q, hs, 0.024, 0.125);
  float rv = dome(rd, 0.0068);
  h += 0.17 * rv;
  // paint system: bare metal → primer (+0.15 mm) → paint (+0.25 mm)
  float edge = 1.0 - smoothstep(0.0, 0.025, -d);
  edge = max(edge, 1.0 - smoothstep(0.006, 0.016, rd));
  edge = max(edge, (1.0 - smoothstep(0.0, 0.02, abs(sdBox(q, hs - vec2(0.085, 0.10), 0.035)))) * step(0.4, hs.y) * 0.6);
  vec2 chip = chipMask(uv, 12.0, edge * 0.9, -0.13 + ph * 0.04, 4.0);
  float s1 = scratches(uv, 10.0, 0.05, 0.5, 0.3, 1.6, 1.3, 0.55, 5.0);
  float s2 = scratches(uv, 16.0, 1.4, 3.0, 0.2, 0.8, 1.0, 0.45, 6.0);
  float scr = max(s1, s2 * 0.8);
  float paintGone = max(chip.x, step(0.5, scr) * 0.0);
  h += 0.0075 * (1.0 - chip.y) + 0.0125 * (1.0 - paintGone);
  h -= 0.012 * scr;
  h += 0.0016 * gnoise(uv * 384.0, vec2(384.0), 9.0); // orange peel
  float state = (1.0 - paintGone) * 0.5 + (1.0 - chip.y) * 0.5; // 1 paint, .5 primer, 0 metal
  return vec4(h, state, ph, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  vec2 q, hs, id; panelOf(m, q, hs, id);
  float ph = H.b; float state = H.g; float scr = H.a;
  // paint: per-panel batch tint + multi-scale value noise + sun-fade / chalking
  vec3 paint = uBase * (0.9 + 0.18 * ph);
  float n1 = fbm01(uv, vec2(3.0), 5, 0.5, 11.0);
  float n2 = fbm01(uv, vec2(14.0), 5, 0.55, 12.0);
  float n3 = fbm01(uv, vec2(64.0), 3, 0.5, 13.0);
  paint *= 0.78 + 0.3 * n1 + 0.12 * (n2 - 0.5) + 0.06 * (n3 - 0.5);
  paint = mix(paint, vec3(luma(paint)), 0.25 * smoothstep(0.4, 0.8, n2));
  vec3 primer = C(0x5a3a2c) * (0.8 + 0.3 * n3);
  vec3 bare = C(0x55585b) * (0.8 + 0.3 * fbm01(uv, vec2(40.0, 6.0), 3, 0.5, 15.0));
  float isPaint = smoothstep(0.7, 0.95, state);
  float isPrimer = smoothstep(0.25, 0.45, state) * (1.0 - isPaint);
  float isMetal = 1.0 - isPaint - isPrimer;
  albedo = paint * isPaint + primer * isPrimer + bare * isMetal;
  rough = (0.5 + 0.2 * n2) * isPaint + 0.8 * isPrimer + (0.4 + 0.2 * n3) * isMetal;
  metal = isMetal;
  // scratches through the paint: thin, burnished, slightly lighter
  float sc = smoothstep(0.15, 0.7, scr) * isPaint;
  albedo = mix(albedo, mix(paint * 1.25, bare * 1.2, 0.5), sc * 0.55);
  metal = max(metal, sc * 0.5); rough = mix(rough, 0.35, sc * 0.6);
  // edge wear: paint polished/lightened on convex edges + rivet heads
  float ew = edgeMask(D, 0.15, 0.6) * isPaint;
  albedo = mix(albedo, albedo * 1.22 + 0.015, ew * 0.6); rough = mix(rough, 0.38, ew * 0.5);
  // rust: only where metal is exposed, plus a halo that stains the surrounding paint
  float rustN = fbm01(uv, vec2(24.0), 5, 0.55, 17.0);
  float rustM = isMetal * smoothstep(0.3, 0.65, rustN);
  vec3 rustC = mix(C(0x3a2112), C(0x6a3818), fbm01(uv, vec2(80.0), 3, 0.5, 18.0));
  albedo = mix(albedo, rustC, rustM * 0.9); rough = mix(rough, 0.88, rustM); metal *= 1.0 - rustM;
  // grime: cavities + fine dirt film + dirt settling along the bottom edge of each panel
  float g = grimeAmount(uv, D, uGrime, 19.0);
  float film = smoothstep(0.35, 0.85, fbm01(uv, vec2(10.0), 6, 0.6, 29.0));
  float settle = 1.0 - smoothstep(0.0, 0.12, m.y - id.y); // bottom of each panel collects grime
  g = sat(g + film * 0.35 * uGrime + settle * 0.35 * uGrime * n2);
  vec3 grimeC = mix(C(0x14110d), C(0x2a231b), n3);
  albedo = mix(albedo, grimeC, g * 0.75); rough = mix(rough, 0.86, g * 0.7); metal *= 1.0 - g * 0.8;
  // dirty wash running down below each horizontal seam (fades over ~35 cm)
  float topY = id.y + 2.0 * hs.y;
  float wash = exp(-(topY - m.y) / 0.35) * (0.5 + 0.5 * streakNoise(uv, 70.0, 2.0, 30.0));
  albedo *= 1.0 - 0.28 * wash * uGrime;
  // leaks: rust-brown or oily-black thin drips from seams + rivet rows (some still wet = glossy)
  float dr = max(dripsBelow(m, 0.7, 26.0, 0.6, 21.0), dripsBelow(m, 2.0, 26.0, 0.9, 22.0));
  dr = max(dr, dripsBelow(m, 0.676, 20.0, 0.3, 23.0) * 0.8);
  dr = max(dr, dripsBelow(m, 1.976, 20.0, 0.4, 24.0) * 0.8);
  float colH = h1f(m.x * 26.0, 25.0);
  vec3 dripC = colH < 0.5 ? mix(C(0x2a1a10), C(0x5a3018), n3) : C(0x0f0d0b);
  albedo = mix(albedo, dripC, dr * 0.7);
  rough = mix(rough, colH > 0.7 ? 0.12 : 0.6, dr);
  metal *= 1.0 - dr * 0.8;
  // damp patches: darker + glossier (condensation)
  float damp = smoothstep(0.6, 0.8, fbm01(uv, vec2(8.0), 6, 0.6, 28.0)) * smoothstep(0.3, 0.7, n1);
  albedo *= 1.0 - 0.12 * damp; rough = mix(rough, 0.25, damp * 0.6);
  albedo *= mix(0.72, 1.0, D.x);
}
`;

export const WALL_DARK = /* glsl */ `
// 2 m tile: 1 m wide sheets with trapezoidal vertical corrugation, a bolted horizontal rail at y = 1.0..1.12
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float col = floor(m.x); float lx = m.x - col - 0.5;
  float sid = h1(ivec2(int(col), 0), 3.0);
  // sheet edge seams (overlap lap joint)
  float dEdge = 0.5 - abs(lx);
  float h = 0.35;
  // corrugation: 4 ribs per sheet, trapezoid profile
  float rp = fract((m.x - col) * 4.0); float rx = abs(rp - 0.5) * 2.0; // 0 at rib centre
  float rib = 1.0 - smoothstep(0.45, 0.75, rx);
  h += 0.25 * rib;
  h *= 1.0;
  // flat margins near sheet edges
  float margin = smoothstep(0.03, 0.06, dEdge);
  h = mix(0.35, h, margin);
  h -= 0.25 * (1.0 - smoothstep(0.0, 0.004, dEdge));
  // rail: C-channel 12 cm tall at y 1.0
  float ry = m.y - 1.06;
  float rail = 1.0 - smoothstep(0.058, 0.062, abs(ry));
  float railH = 0.75 + 0.05 * (1.0 - smoothstep(0.045, 0.058, abs(ry)));
  h = mix(h, railH, rail);
  // bolts on the rail every 0.25 m (hex heads)
  float bx = fract(m.x * 4.0 + 0.5) - 0.5; vec2 bq = vec2(bx / 4.0, ry);
  float hd = hexDist(bq);
  float bolt = 1.0 - smoothstep(0.0095, 0.011, hd);
  float washer = 1.0 - smoothstep(0.0125, 0.0135, length(bq));
  h += rail * (0.05 * washer + 0.12 * bolt * (0.8 + 0.2 * smoothstep(0.011, 0.004, hd)));
  // lap rivets along sheet edges
  vec2 rq = vec2(dEdge - 0.022, fract(m.y * 8.0) / 8.0 - 0.0625);
  float rv = dome(length(rq), 0.006);
  h += 0.14 * rv * (1.0 - rail);
  h += 0.03 * fbm(uv, vec2(6.0), 4, 0.5, 4.0);
  float dent = smoothstep(0.7, 1.0, fbm01(uv, vec2(14.0), 3, 0.5, 5.0));
  h -= 0.05 * dent;
  float edge = max(1.0 - smoothstep(0.0, 0.02, dEdge), rail * (1.0 - smoothstep(0.0, 0.01, 0.06 - abs(ry))));
  edge = max(edge, rib * smoothstep(0.3, 0.45, rx) * 0.7);
  edge = max(edge, rail * washer);
  vec2 chip = chipMask(uv, 14.0, edge, -0.04, 6.0);
  float scr = scratches(uv, 12.0, 1.57, 0.5, 0.3, 1.2, 1.2, 0.5, 7.0);
  h += 0.006 * (1.0 - chip.y) + 0.01 * (1.0 - chip.x) - 0.01 * scr;
  h += 0.0015 * gnoise(uv * 384.0, vec2(384.0), 9.0);
  float state = (1.0 - chip.x) * 0.5 + (1.0 - chip.y) * 0.5;
  return vec4(h, state, sid, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float state = H.g; float scr = H.a;
  float mott = fbm01(uv, vec2(5.0), 5, 0.5, 11.0);
  vec3 paint = uBase * (0.85 + 0.3 * mott) * (0.92 + 0.16 * H.b);
  vec3 bare = vec3(0.34, 0.35, 0.36) * (0.8 + 0.3 * fbm01(uv, vec2(6.0, 60.0), 3, 0.5, 12.0));
  vec3 primer = C(0x3b3a36);
  float isPaint = smoothstep(0.7, 0.95, state);
  float isPrimer = smoothstep(0.25, 0.45, state) * (1.0 - isPaint);
  float isMetal = 1.0 - isPaint - isPrimer;
  albedo = paint * isPaint + primer * isPrimer + bare * isMetal;
  rough = (0.48 + 0.2 * mott) * isPaint + 0.7 * isPrimer + 0.45 * isMetal;
  metal = isMetal;
  float sc = smoothstep(0.1, 0.6, scr) * isPaint;
  albedo = mix(albedo, bare * 0.9, sc * 0.6); metal = max(metal, sc * 0.6); rough = mix(rough, 0.3, sc * 0.6);
  float ew = edgeMask(D, 0.1, 0.4);
  albedo = mix(albedo, albedo * 1.4 + 0.03, ew * 0.5 * isPaint); rough = mix(rough, 0.3, ew * 0.4);
  float rustN = fbm01(uv, vec2(12.0), 5, 0.55, 17.0);
  float rustM = (isMetal + isPrimer * 0.5) * smoothstep(0.4, 0.7, rustN);
  rustM = max(rustM, cavityMask(D, 0.02, 0.1) * smoothstep(0.55, 0.8, rustN) * 0.8);
  vec3 rustC = mix(C(0x33200f), C(0x64381c), fbm01(uv, vec2(60.0), 3, 0.5, 18.0));
  albedo = mix(albedo, rustC, rustM * 0.85); rough = mix(rough, 0.88, rustM); metal *= 1.0 - rustM;
  float g = grimeAmount(uv, D, uGrime, 19.0);
  albedo = mix(albedo, C(0x0e0c0a), g * 0.85); rough = mix(rough, 0.9, g * 0.7); metal *= 1.0 - g;
  // oil leaking down from the rail + bolts, glossy
  float dr = dripsBelow(m, 1.0, 9.0, 0.9, 21.0);
  dr = max(dr, dripsBelow(m, 2.0, 7.0, 0.6, 22.0) * 0.8);
  vec3 oil = C(0x0b0908);
  albedo = mix(albedo, oil, dr * 0.85); rough = mix(rough, 0.12, dr * 0.9); metal *= 1.0 - dr * 0.7;
  float st = streakNoise(uv, 40.0, 2.0, 27.0) * fbm01(uv, vec2(3.0), 3, 0.5, 28.0);
  albedo *= 1.0 - 0.35 * smoothstep(0.25, 0.6, st);
  rough = mix(rough, 0.2, smoothstep(0.35, 0.65, st) * 0.5);
  albedo *= 0.75 + 0.4 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  albedo *= mix(0.6, 1.0, D.x);
}
`;

export const WALL_MEDICAL = /* glsl */ `
// 2 m tile: clean-room panels 1 m × 2 m with rounded seams, 4 capped screws per panel, a rubber bump strip at 0.9 m.
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float col = floor(m.x);
  vec2 q = m - vec2(col + 0.5, 1.0); vec2 hs = vec2(0.5, 1.0);
  float d = sdBox(q, hs - 0.003, 0.02);
  float h = 0.3 + 0.35 * roundBevel(d, 0.006);
  // pillow: very slight bulge
  h += 0.04 * (1.0 - dot(q / hs, q / hs) * 0.5) * bevel(d, 0.05);
  // screw caps
  vec2 sq = abs(q) - (hs - vec2(0.04, 0.04));
  float sd = length(sq);
  h += 0.06 * dome(sd, 0.007);
  float rail = 0.0;
  h += 0.003 * gnoise(uv * 256.0, vec2(256.0), 3.0);
  h += 0.01 * fbm(uv, vec2(6.0), 3, 0.5, 4.0);
  float scuff = scratches(uv, 14.0, 0.0, 0.6, 0.2, 0.6, 2.0, 0.5, 5.0);
  h -= 0.006 * scuff;
  return vec4(h, rail, h1(ivec2(int(col), 1), 6.0), scuff);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float rail = H.g; float scuff = H.a;
  float mott = fbm01(uv, vec2(4.0), 5, 0.5, 11.0);
  vec3 base = uBase * (0.95 + 0.06 * H.b) * (0.94 + 0.1 * mott);
  // yellowing near seams & lower edge of tile
  float yell = cavityMask(D, 0.0, 0.06) + (1.0 - smoothstep(0.0, 0.25, m.y)) * 0.3;
  base = mix(base, base * vec3(0.95, 0.9, 0.78), sat(yell) * 0.6);
  albedo = base;
  rough = 0.32 + 0.12 * mott;
  metal = 0.0;
  // bump rail: dark grey rubber
  albedo = mix(albedo, C(0x2b2e30) * (0.9 + 0.2 * mott), rail);
  rough = mix(rough, 0.7, rail);
  // black scuff marks (shoe / trolley) — mostly low on the panel
  float sm = smoothstep(0.7, 0.9, fbm01(uv, vec2(12.0, 48.0), 5, 0.6, 12.0)) * smoothstep(0.5, 0.8, fbm01(uv, vec2(4.0), 3, 0.5, 31.0));
  albedo = mix(albedo, C(0x3a3631), sm * 0.35);
  albedo = mix(albedo, albedo * 0.7, smoothstep(0.1, 0.5, scuff));
  rough = mix(rough, 0.55, smoothstep(0.1, 0.5, scuff));
  // smudges
  float smd = smudges(uv, 6.0, 13.0);
  rough = mix(rough, 0.55, smd * 0.6);
  albedo *= 1.0 - smd * 0.06;
  // grime in seams
  float g = grimeAmount(uv, D, uGrime, 19.0);
  albedo = mix(albedo, C(0x3e3428), g * 0.7); rough = mix(rough, 0.75, g * 0.7);
  // faint drips (cleaning fluid / condensation) below the top seam
  float dr = dripsBelow(m, 2.0, 18.0, 0.6, 21.0) * 0.6;
  albedo = mix(albedo, albedo * vec3(0.8, 0.76, 0.68), dr * 0.6); rough = mix(rough, 0.18, dr * 0.6);
  // the odd smear of dried blood (clean room after the incident) — rare, large-scale
  float bl = smoothstep(0.8, 0.9, fbm01(uv, vec2(3.0, 9.0), 5, 0.55, 30.0)) * (1.0 - rail);
  albedo = mix(albedo, C(0x4a120d), bl * 0.55); rough = mix(rough, 0.5, bl * 0.5);
  albedo *= 0.9 + 0.15 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  albedo *= mix(0.7, 1.0, D.x);
}
`;

export const CEILING = /* glsl */ `
// 2 m tile: T-bar grid of 1 m tiles; three perforated acoustic panels and one louvred vent.
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  vec2 cell = floor(m); vec2 q = m - cell - 0.5;
  bool vent = cell.x > 0.5 && cell.y > 0.5;
  float d = sdBox(q, vec2(0.5 - 0.013), 0.002);
  float frame = 1.0 - smoothstep(-0.002, 0.002, d);
  float h = 0.35;
  float id = h1(ivec2(cell), 2.0);
  if (!vent) {
    // perforation 2 cm pitch, 6 mm holes, with an unperforated 5 cm margin
    vec2 hp = fract(m * 50.0) - 0.5;
    float hole = 1.0 - smoothstep(0.13, 0.19, length(hp));
    float inMargin = step(sdBox(q, vec2(0.43), 0.0), 0.0);
    h -= 0.2 * hole * inMargin;
    // slight sag
    h -= 0.06 * (1.0 - dot(q, q) * 4.0) * id;
  } else {
    // louvre slots
    float sd = sdBox(q, vec2(0.36, 0.36), 0.02);
    float inVent = step(sd, 0.0);
    float lp = fract(q.y * 18.0);
    float louv = smoothstep(0.0, 0.6, lp) * (1.0 - smoothstep(0.75, 0.85, lp));
    h = mix(h + 0.08 * roundBevel(sdBox(q, vec2(0.4), 0.03), 0.01), 0.1 + 0.5 * louv, inVent);
    // screws
    float sc = length(abs(q) - vec2(0.43));
    h += 0.1 * dome(sc, 0.006);
  }
  // T-bar flange: raised, rounded
  float tb = 1.0 - smoothstep(0.0, 0.013, -d);
  h = mix(h, 0.75 + 0.1 * dome(max(0.0, 0.013 + d), 0.013), tb);
  h += 0.02 * fbm(uv, vec2(8.0), 4, 0.5, 4.0);
  return vec4(h, tb, vent ? 1.0 : 0.0, id);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float tb = H.g; float vent = H.b;
  float mott = fbm01(uv, vec2(5.0), 5, 0.5, 11.0);
  albedo = uBase * (0.85 + 0.3 * mott) * (0.9 + 0.2 * H.a);
  rough = 0.6 + 0.2 * mott;
  metal = 0.0;
  // T-bars: bare galvanised
  vec3 galv = vec3(0.42, 0.43, 0.43) * (0.85 + 0.3 * fbm01(uv, vec2(60.0), 3, 0.5, 12.0));
  albedo = mix(albedo, galv, tb); metal = mix(metal, 0.9, tb); rough = mix(rough, 0.45, tb);
  // vent: dark inside, soot streaks blown out of the louvres
  albedo = mix(albedo, albedo * 0.5, vent * 0.6);
  float soot = vent * smoothstep(0.3, 0.8, fbm01(uv, vec2(16.0, 4.0), 4, 0.5, 13.0));
  albedo = mix(albedo, C(0x0d0c0b), soot * 0.6); rough = mix(rough, 0.9, soot);
  float g = grimeAmount(uv, D, uGrime, 19.0);
  albedo = mix(albedo, C(0x0d0c0b), g * 0.8); rough = mix(rough, 0.9, g * 0.6); metal *= 1.0 - g;
  // water stains (rings) from leaks above
  vec3 w = worley(uv * 3.0, vec2(3.0), 14.0);
  float ring = smoothstep(0.02, 0.0, abs(w.x - 0.35 - 0.05 * fbm(uv, vec2(12.0), 3, 0.5, 15.0))) * step(0.6, w.z);
  float inside = smoothstep(0.37, 0.3, w.x) * step(0.6, w.z);
  albedo = mix(albedo, albedo * vec3(0.75, 0.62, 0.45), ring * 0.8 + inside * 0.25);
  albedo *= 0.8 + 0.3 * fbm01(uv, vec2(2.0), 3, 0.5, 40.0);
  albedo *= mix(0.55, 1.0, D.x);
}
`;
