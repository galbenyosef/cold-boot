/**
 * Shared GLSL ES 3.0 library for the procedural texture baker.
 *
 * Every function is TILEABLE: noise lattices are wrapped with an integer period, so any pattern evaluated
 * over uv ∈ [0,1)² with integer frequencies repeats seamlessly. Layout helpers work in metres
 * (`uv * uTile`) so authoring is physical.
 */
export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragColor1;

uniform vec2 uRes;       // output resolution (texels)
uniform int uPass;       // 0 height+masks; 1 MRT: albedo(+alpha) → 0, ORM → 1
uniform float uSeed;
uniform float uTile;     // tile size in metres
uniform float uDepth;    // metres represented by height 0..1
uniform sampler2D tH;    // height pass output  (r = height, gba = masks)
uniform sampler2D tD;    // derived: r = AO, g = small curvature, b = large curvature, a = low-pass height

#define PI 3.14159265359
#define TAU 6.28318530718

// ───────────────────────────── hashing (pcg3d — good quality, integer based)
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 h3(ivec2 c, float s) {
  return vec3(pcg3d(uvec3(ivec3(c, int(s * 131.0) + int(uSeed * 7919.0))))) * (1.0 / 4294967295.0);
}
float h1(ivec2 c, float s) { return h3(c, s).x; }
float h1f(float x, float s) { return h3(ivec2(int(floor(x)), 7), s).x; }

ivec2 wrapc(ivec2 c, ivec2 P) { return c - P * ivec2(floor(vec2(c) / vec2(P))); }

// ───────────────────────────── periodic noises (p in lattice units, period in cells)
float vnoise(vec2 p, vec2 per, float s) {
  ivec2 P = ivec2(per + 0.5);
  vec2 i = floor(p); vec2 f = p - i; ivec2 c = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = h1(wrapc(c, P), s), b = h1(wrapc(c + ivec2(1, 0), P), s);
  float cc = h1(wrapc(c + ivec2(0, 1), P), s), d = h1(wrapc(c + ivec2(1, 1), P), s);
  return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y);
}
vec2 grad2(ivec2 c, float s) { float a = h1(c, s) * TAU; return vec2(cos(a), sin(a)); }
// gradient noise, ~[-1,1]
float gnoise(vec2 p, vec2 per, float s) {
  ivec2 P = ivec2(per + 0.5);
  vec2 i = floor(p); vec2 f = p - i; ivec2 c = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(wrapc(c, P), s), f);
  float b = dot(grad2(wrapc(c + ivec2(1, 0), P), s), f - vec2(1, 0));
  float cc = dot(grad2(wrapc(c + ivec2(0, 1), P), s), f - vec2(0, 1));
  float d = dot(grad2(wrapc(c + ivec2(1, 1), P), s), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y) * 1.6;
}
// fbm over the tile: uv in [0,1), f0 = integer base frequency per tile. Returns ~[-1,1].
float fbm(vec2 uv, vec2 f0, int oct, float gain, float s) {
  float sum = 0.0, amp = 1.0, norm = 0.0; vec2 f = f0;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    sum += amp * gnoise(uv * f, f, s + float(i) * 17.31);
    norm += amp; amp *= gain; f *= 2.0;
  }
  return sum / norm;
}
float fbm01(vec2 uv, vec2 f0, int oct, float gain, float s) { return clamp(0.5 + 0.5 * fbm(uv, f0, oct, gain, s) * 1.5, 0.0, 1.0); }
// ridged multifractal-ish, [0,1]
float ridged(vec2 uv, vec2 f0, int oct, float s) {
  float sum = 0.0, amp = 0.5, norm = 0.0; vec2 f = f0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(gnoise(uv * f, f, s + float(i) * 11.7));
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.0;
  }
  return sum / norm;
}
// domain-warped fbm (organic stains)
float warped(vec2 uv, vec2 f0, int oct, float warp, float s) {
  vec2 q = vec2(fbm(uv, f0, 4, 0.5, s + 3.0), fbm(uv, f0, 4, 0.5, s + 9.0));
  // warp must keep tiling: offset uv then evaluate the periodic fbm (periodic in uv) — valid.
  return fbm(uv + q * warp / f0, f0, oct, 0.5, s + 21.0);
}

// Worley: returns (F1, F2, cellHash) in lattice units
vec3 worley(vec2 p, vec2 per, float s) {
  ivec2 P = ivec2(per + 0.5);
  vec2 i = floor(p), f = p - i; float F1 = 8.0, F2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 c = ivec2(i) + ivec2(x, y);
    vec3 h = h3(wrapc(c, P), s);
    vec2 o = vec2(x, y) + h.xy - f;
    float d = dot(o, o);
    if (d < F1) { F2 = F1; F1 = d; id = h.z; } else if (d < F2) F2 = d;
  }
  return vec3(sqrt(F1), sqrt(F2), id);
}
// Exact voronoi border distance (two pass). Returns (edgeDist, cellHash, F1).
vec3 voronoiEdge(vec2 p, vec2 per, float s, float jitter) {
  ivec2 P = ivec2(per + 0.5);
  vec2 i = floor(p), f = p - i;
  vec2 mr = vec2(0); float md = 8.0; float id = 0.0; ivec2 mc = ivec2(0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 c = ivec2(x, y);
    vec3 h = h3(wrapc(ivec2(i) + c, P), s);
    vec2 r = vec2(c) + 0.5 + (h.xy - 0.5) * jitter - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; id = h.z; mc = c; }
  }
  float ed = 8.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    ivec2 c = mc + ivec2(x, y);
    vec3 h = h3(wrapc(ivec2(i) + c, P), s);
    vec2 r = vec2(c) + 0.5 + (h.xy - 0.5) * jitter - f;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1e-5) ed = min(ed, dot(0.5 * (mr + r), normalize(dr)));
  }
  return vec3(ed, id, sqrt(md));
}

// ───────────────────────────── shapes / profiles
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// 1 deep inside (d << 0), 0 outside; w = bevel width
float bevel(float d, float w) { return smoothstep(0.0, 1.0, clamp(-d / w, 0.0, 1.0)); }
// rounded bevel (quarter-circle profile)
float roundBevel(float d, float w) { float x = clamp(1.0 + d / w, 0.0, 1.0); return d > 0.0 ? 0.0 : sqrt(max(0.0, 1.0 - x * x)); }
float dome(float d, float R) { float x = clamp(d / R, 0.0, 1.0); return sqrt(max(0.0, 1.0 - x * x)); }
float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.8660254, 0.5)), p.y); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b) { return sat((x - a) / (b - a)); }

// Distance (metres) to the nearest rivet on a rectangle of rivets inset into a panel.
// q: panel-local centred coords (m); hs: panel half size; inset; spacing.
float rivetDist(vec2 q, vec2 hs, float inset, float spacing) {
  vec2 b = hs - inset;
  float n = max(1.0, floor(2.0 * b.x / spacing + 0.5)); float sx = 2.0 * b.x / n;
  float x = clamp(floor((q.x + b.x) / sx + 0.5), 0.0, n) * sx - b.x;
  float d1 = min(length(q - vec2(x, b.y)), length(q - vec2(x, -b.y)));
  float m = max(1.0, floor(2.0 * b.y / spacing + 0.5)); float sy = 2.0 * b.y / m;
  float y = clamp(floor((q.y + b.y) / sy + 0.5), 0.0, m) * sy - b.y;
  float d2 = min(length(q - vec2(b.x, y)), length(q - vec2(-b.x, y)));
  return min(d1, d2);
}

// Scratch field (tileable). uv in tile; cells per tile (integer); angle/spread radians; lengths in cell units;
// width in texels. Returns 0..1 groove intensity.
float scratches(vec2 uv, float cells, float angle, float spread, float lenMin, float lenMax, float widthTex, float density, float s) {
  vec2 p = uv * cells; vec2 i = floor(p); ivec2 P = ivec2(cells + 0.5);
  float w0 = widthTex * cells / uRes.x;
  float r = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 c = ivec2(i) + ivec2(x, y); ivec2 cw = wrapc(c, P);
    for (int k = 0; k < 3; k++) {
      vec3 ha = h3(cw, s + float(k) * 13.1);
      vec3 hb = h3(cw, s + float(k) * 7.7 + 100.0);
      if (hb.z > density) continue;
      vec2 ctr = vec2(c) + ha.xy;
      float a = angle + (ha.z - 0.5) * spread;
      vec2 dir = vec2(cos(a), sin(a));
      float L = mix(lenMin, lenMax, hb.x * hb.x) * 0.5;
      vec2 d = p - ctr;
      float t = clamp(dot(d, dir), -L, L);
      // slight bow so scratches are not ruler-straight
      vec2 nrm = vec2(-dir.y, dir.x);
      float bow = (hb.y - 0.5) * 0.15 * L * (1.0 - (t / L) * (t / L));
      float dist = abs(dot(d - dir * t, nrm) - bow) + max(0.0, abs(dot(d, dir)) - L);
      float taper = 1.0 - pow(abs(t) / L, 3.0);
      float w = w0 * (0.5 + hb.y) * (0.35 + 0.65 * taper);
      r = max(r, (1.0 - smoothstep(0.0, w, dist)) * mix(0.35, 1.0, ha.x) * taper);
    }
  }
  return r;
}

// Vertical drip / leak streaks hanging below a horizontal line at y = y0 (metres, uv-space y up).
// m = metres coords, cols = candidate streak columns per metre, density = fraction of columns used.
// Thin (2–12 mm), tapered, wobbling, broken; a wider stain blob at the source. Returns 0..1.
float dripsBelow(vec2 m, float y0, float cols, float maxLen, float s) {
  float dy = y0 - m.y; if (dy < 0.0) return 0.0;
  float cx = m.x * cols; float ci = floor(cx); float fx = cx - ci;
  vec3 h = h3(ivec2(int(ci), int(y0 * 100.0)), s);
  if (h.z > 0.6) return 0.0;
  float L = maxLen * (0.12 + 0.88 * h.x * h.x);
  float t = dy / L; if (t > 1.0) return 0.0;
  float colW = 1.0 / cols;
  float wid = mix(0.0025, 0.012, h.y * h.y) * (1.0 - 0.65 * t) / colW;
  float wob = (0.003 * sin(dy * 23.0 + h.x * 30.0) + 0.0015 * sin(dy * 71.0 + h.y * 10.0)) / colW;
  float ctr = 0.25 + 0.5 * (h.z / 0.6) + wob;
  float d = abs(fx - ctr);
  float across = 1.0 - smoothstep(wid * 0.25, wid, d);
  float along = (1.0 - t) * smoothstep(0.0, 0.003, dy);
  along *= 0.55 + 0.45 * vnoise(vec2(ci * 7.0, dy * 40.0), vec2(4096.0), s + 3.0);
  float head = exp(-dy / 0.025) * (1.0 - smoothstep(wid * 1.2, wid * 3.5, d));
  return clamp(max(across * along, head * 0.8), 0.0, 1.0);
}
// Dirt wash that collects just below a horizontal ledge/seam and fades downward.
float washBelow(vec2 m, float y0, float len) {
  float dy = y0 - m.y; if (dy < 0.0) return 0.0;
  return exp(-dy / len);
}

// Generic stretched streak noise (rain / leak streaks) — tileable. fx >> fy gives vertical streaks.
float streakNoise(vec2 uv, float fx, float fy, float s) {
  float n = vnoise(uv * vec2(fx, fy), vec2(fx, fy), s);
  float n2 = vnoise(uv * vec2(fx * 2.0, fy * 3.0), vec2(fx * 2.0, fy * 3.0), s + 5.0);
  return n * 0.7 + n2 * 0.3;
}

vec3 srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 hex(float h) { return vec3(floor(h / 65536.0), mod(floor(h / 256.0), 256.0), mod(h, 256.0)) / 255.0; }
vec3 C(int h) { return vec3(float((h >> 16) & 255), float((h >> 8) & 255), float(h & 255)) / 255.0; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// ───────────────────────────── shared compose helpers
// D.y small curvature (+ convex), D.z large curvature.
float edgeMask(vec4 D, float lo, float hi) { return smoothstep(lo, hi, D.y + D.z * 0.5); }
float cavityMask(vec4 D, float lo, float hi) { return smoothstep(lo, hi, -(D.y * 0.5 + D.z)) ; }
// Chipped paint: returns (paintGone, primerGone) — crisp thresholds on fbm, biased up by edge proximity.
vec2 chipMask(vec2 uv, float freq, float edge, float amount, float s) {
  float n = fbm01(uv, vec2(freq), 6, 0.6, s);
  float t = n + edge * 0.45 + amount;
  return vec2(smoothstep(0.715, 0.73, t), smoothstep(0.79, 0.80, t));
}
// Grime that collects in cavities, modulated by noise. 0..1.
float grimeAmount(vec2 uv, vec4 D, float amount, float s) {
  float cav = sat((1.0 - D.x) * 2.2) + cavityMask(D, 0.01, 0.12) * 0.8;
  float n = fbm01(uv, vec2(8.0), 5, 0.55, s);
  return sat(cav * (0.35 + 1.1 * n) * amount + sat(n - 0.72) * amount * 0.8);
}
// Fingerprint / smudge field 0..1 (for glossy surfaces)
float smudges(vec2 uv, float freq, float s) {
  vec3 w = worley(uv * freq, vec2(freq), s);
  float blob = smoothstep(0.55, 0.15, w.x) * step(0.55, w.z);
  float ridges = 0.5 + 0.5 * sin(w.x * 140.0 + w.z * 30.0);
  return blob * mix(0.6, 1.0, ridges) * fbm01(uv, vec2(freq * 2.0), 3, 0.5, s + 4.0);
}
`;

/** Wraps a material body (defining `vec4 heightFn(vec2 uv)` and `void surf(...)`) into a full baking shader. */
export const GLSL_MAIN = /* glsl */ `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uPass == 0) { fragColor = heightFn(uv); fragColor1 = vec4(0.0); return; }
  vec4 H = texture(tH, uv);
  vec4 D = texture(tD, uv);
  vec3 albedo = vec3(0.5); float rough = 0.5; float metal = 0.0; float alpha = 1.0; vec3 emis = vec3(0.0);
  surf(uv, H, D, albedo, rough, metal, alpha, emis);
  fragColor = vec4(srgb2lin(clamp(albedo, 0.0, 1.0)), alpha);
  fragColor1 = vec4(clamp(D.x, 0.0, 1.0), clamp(rough, 0.02, 1.0), clamp(metal, 0.0, 1.0), 1.0);
}
`;

export const GLSL_VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
