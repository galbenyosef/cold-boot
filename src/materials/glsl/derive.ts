/**
 * Generic passes that turn a height field into: (mode 0) AO + curvature + low-pass height,
 * (mode 1) a tangent-space normal map. Physically scaled: height 0..1 = uDepth metres, tile = uTile metres.
 */
export const GLSL_DERIVE = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 fragColor;
uniform sampler2D tH;
uniform vec2 uRes;
uniform float uTile;
uniform float uDepth;
uniform int uMode;
uniform float uNormalMul;
uniform float uAoRadius;   // metres
uniform float uAoStrength;

ivec2 R;
float Hh(ivec2 p) { p = p - R * ivec2(floor(vec2(p) / vec2(R))); return texelFetch(tH, p, 0).r; }
float Hb(vec2 q) { // bilinear fetch with wrap
  vec2 f = fract(q); ivec2 i = ivec2(floor(q));
  float a = Hh(i), b = Hh(i + ivec2(1, 0)), c = Hh(i + ivec2(0, 1)), d = Hh(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  R = ivec2(uRes);
  ivec2 p = ivec2(gl_FragCoord.xy);
  float texel = uTile / uRes.x;
  if (uMode == 1) {
    float tl = Hh(p + ivec2(-1, 1)), t = Hh(p + ivec2(0, 1)), tr = Hh(p + ivec2(1, 1));
    float l = Hh(p + ivec2(-1, 0)), r = Hh(p + ivec2(1, 0));
    float bl = Hh(p + ivec2(-1, -1)), b = Hh(p + ivec2(0, -1)), br = Hh(p + ivec2(1, -1));
    // blend of Sobel (smooth) and central difference (crisp)
    float sx = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) / 8.0;
    float sy = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) / 8.0;
    float cx = (r - l) * 0.5, cy = (t - b) * 0.5;
    float dx = mix(sx, cx, 0.5), dy = mix(sy, cy, 0.5);
    float k = uDepth / texel * uNormalMul;
    vec3 n = normalize(vec3(-dx * k, -dy * k, 1.0));
    fragColor = vec4(n * 0.5 + 0.5, 1.0);
    return;
  }
  float h0 = Hh(p);
  // horizon-based AO
  float rpx = max(2.0, uAoRadius / texel);
  float occ = 0.0;
  float jit = ign(vec2(p));
  const int DIRS = 10; const int STEPS = 7;
  for (int d = 0; d < DIRS; d++) {
    float a = (float(d) + jit) / float(DIRS) * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    float mx = 0.0;
    for (int s = 1; s <= STEPS; s++) {
      float fr = float(s) / float(STEPS);
      float r = max(1.0, rpx * fr * fr);
      float hs = Hb(vec2(p) + dir * r);
      float e = (hs - h0) * uDepth / (r * texel);
      float sn = e / sqrt(1.0 + e * e);
      mx = max(mx, sn * (1.0 - fr * 0.5));
    }
    occ += mx;
  }
  float ao = 1.0 - occ / float(DIRS) * uAoStrength;
  // curvature (positive = convex) — dimensionless slope-like measure
  float m1 = 0.0, m2 = 0.0, m3 = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    m1 += Hb(vec2(p) + dir * 1.5);
    m2 += Hb(vec2(p) + dir * 5.0);
    m3 += Hb(vec2(p) + dir * 18.0) + Hb(vec2(p) + dir * 10.0);
  }
  m1 /= 8.0; m2 /= 8.0; m3 /= 16.0;
  float c1 = (h0 - m1) * uDepth / (1.5 * texel);
  float c2 = (h0 - m2) * uDepth / (5.0 * texel);
  fragColor = vec4(clamp(ao, 0.0, 1.0), c1, c2, m3);
}
`;
