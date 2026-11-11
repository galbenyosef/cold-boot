/** Robot shell composite: off-white panels with fine cut lines, flush screws, chips revealing dark composite. */
export const ROBOT_SHELL = /* glsl */ `
// 1 m tile = 2×2 cells of 50 cm; each cell is either whole or split once (horizontally / vertically,
// off-centre) so the panel lines read as designed seams rather than a grid.
float panelLines(vec2 m, out float pid, out vec2 lq, out vec2 hsz) {
  vec2 g = m * 2.0; vec2 c = floor(g); vec2 f = fract(g);
  vec3 h = h3(wrapc(ivec2(c), ivec2(2)), 1.0);
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  vec2 lo = vec2(0.0), hi = vec2(1.0);
  float sp = mix(0.3, 0.7, h.y);
  if (h.x < 0.4) { d = min(d, abs(f.y - sp)); if (f.y < sp) hi.y = sp; else lo.y = sp; }
  else if (h.x < 0.75) { d = min(d, abs(f.x - sp)); if (f.x < sp) hi.x = sp; else lo.x = sp; }
  pid = h1(ivec2(c * 4.0 + step(sp, f) * 2.0), 3.0);
  lq = (f - (lo + hi) * 0.5) / 2.0;   // metres from sub-panel centre
  hsz = (hi - lo) * 0.25;             // sub-panel half size in metres
  return d / 2.0;                     // metres to nearest seam
}
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float pid; vec2 lq, hsz;
  float dl = panelLines(m, pid, lq, hsz);
  float h = 0.25 + 0.45 * roundBevel(-dl + 0.0012, 0.0045);
  // a few panels carry a shallow recessed access hatch or a small grille
  if (pid > 0.8) {
    float dp = sdBox(lq, hsz * 0.55, 0.012);
    h -= 0.06 * smoothstep(0.002, -0.002, dp);
    h -= 0.04 * (1.0 - smoothstep(0.0, 0.0015, abs(dp)));
  } else if (pid < 0.12) {
    vec2 gq = lq - vec2(0.0, -hsz.y * 0.45);
    float inG = step(sdBox(gq, vec2(hsz.x * 0.5, 0.025), 0.004), 0.0);
    float sl = abs(fract(gq.y * 100.0) - 0.5);
    h -= inG * 0.12 * smoothstep(0.15, 0.3, sl);
  }
  // flush screws at sub-panel corners
  vec2 sq = abs(lq) - (hsz - 0.02);
  float sd = length(sq);
  float screw = 1.0 - smoothstep(0.0035, 0.0045, sd);
  h -= 0.08 * screw;
  h += 0.05 * screw * (1.0 - smoothstep(0.0012, 0.0018, hexDist(sq)));
  // slight surface waviness of a moulded part
  h += 0.02 * fbm(uv, vec2(4.0), 4, 0.5, 4.0);
  float edge = 1.0 - smoothstep(0.0, 0.012, dl);
  vec2 chip = chipMask(uv, 14.0, edge * 0.9, -0.15, 5.0);
  float scr = scratches(uv, 12.0, 0.6, 3.2, 0.15, 0.8, 1.0, 0.5, 6.0);
  h -= 0.03 * chip.x + 0.015 * scr;
  h += 0.0015 * gnoise(uv * 400.0, vec2(400.0), 7.0);
  return vec4(h, chip.x, pid, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float chip = H.g; float pid = H.b; float scr = H.a;
  float n1 = fbm01(uv, vec2(4.0), 5, 0.5, 11.0);
  float n2 = fbm01(uv, vec2(16.0), 4, 0.5, 12.0);
  vec3 shell = uBase * (0.95 + 0.07 * pid) * (0.93 + 0.1 * n1);
  shell = mix(shell, shell * vec3(0.94, 0.94, 0.9), step(0.65, pid)); // different moulding batch
  albedo = shell; rough = 0.36 + 0.14 * n2; metal = 0.0;
  // chips reveal the dark grey composite substrate
  albedo = mix(albedo, C(0x2e3032) * (0.8 + 0.4 * n2), chip); rough = mix(rough, 0.7, chip);
  float sc = smoothstep(0.15, 0.6, scr);
  albedo = mix(albedo, albedo * 0.78, sc * 0.6); rough = mix(rough, 0.55, sc);
  // grime in seams and recesses, soft dirt film elsewhere
  float g = grimeAmount(uv, D, uGrime, 19.0);
  albedo = mix(albedo, C(0x2a241c), g * 0.75); rough = mix(rough, 0.7, g * 0.5);
  float film = smoothstep(0.45, 0.9, fbm01(uv, vec2(6.0), 6, 0.6, 22.0));
  albedo = mix(albedo, albedo * vec3(0.78, 0.74, 0.66), film * 0.55); rough = mix(rough, 0.55, film * 0.4);
  // thin hydraulic fluid runs
  float st = dripsBelow(uv * uTile, 1.0, 20.0, 0.5, 20.0) + dripsBelow(uv * uTile, 0.5, 20.0, 0.35, 21.0);
  albedo = mix(albedo, C(0x2a2016), sat(st) * 0.35); rough = mix(rough, 0.2, sat(st) * 0.5);
  float smd = smudges(uv, 4.0, 23.0);
  albedo *= 1.0 - smd * 0.1;
  albedo *= mix(0.65, 1.0, D.x);
}
`;
