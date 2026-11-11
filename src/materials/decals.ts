/**
 * Decal materials: GPU-painted (one uber shader, `uKind` selects the decal), cached per (name, variant).
 * Decal quads use plain 0..1 UVs (not metres). Textures are 256² (blood_pool / scorch 512²).
 */
import * as THREE from 'three';
import type { DecalName } from '../core/types';
import type { Baker, TexDef } from './baker';

const KINDS: DecalName[] = ['blood_splat', 'blood_smear', 'blood_pool', 'oil_stain', 'oil_drip', 'scorch',
  'bullet_metal', 'bullet_concrete', 'scratches', 'grime', 'handprint', 'water_stain'];

export const DECAL_VARIANTS = 4;
export const DECAL_COUNT = KINDS.length * DECAL_VARIANTS;

const GLSL_DECAL = /* glsl */ `
uniform int uKind;
uniform float uVar;
// non-periodic-looking helpers (period large enough not to matter inside one decal)
float nz(vec2 p, float f, float s) { return gnoise(p * f + 50.0, vec2(256.0), s); }
float fb(vec2 p, float f, int oct, float s) {
  float a = 0.5, sum = 0.0, n = 0.0;
  for (int i = 0; i < 7; i++) { if (i >= oct) break; sum += a * nz(p, f, s + float(i) * 3.1); n += a; a *= 0.5; f *= 2.0; }
  return sum / n;
}
float rnd(float i, float s) { return h3(ivec2(int(i), int(uVar * 13.0) + 3), s).x; }
float angNoise(float ang, float freq, float s) { return gnoise(vec2(ang / TAU * freq, 0.5), vec2(freq, 64.0), s); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float border(vec2 uv) { vec2 e = min(uv, 1.0 - uv); return smoothstep(0.0, 0.04, min(e.x, e.y)); }

// returns (coverage, thickness, aux1, aux2)
vec4 splat(vec2 p, float size, float spikesAmt, int drops, float s) {
  float r = length(p); float ang = atan(p.y, p.x);
  float R = size * (1.0 + 0.18 * angNoise(ang, 7.0, s) + 0.08 * angNoise(ang, 19.0, s + 1.0)) + 0.03 * fb(p, 6.0, 3, s + 2.0);
  float spk = pow(sat(angNoise(ang, 31.0, s + 3.0) * 0.8 + 0.25), 3.0) * spikesAmt;
  float Rs = R + spk * 0.45;
  float main = smoothstep(Rs + 0.01, Rs - 0.01, r);
  float thick = main * (0.4 + 0.6 * smoothstep(Rs, Rs * 0.2, r));
  float cov = main;
  for (int i = 0; i < 28; i++) {
    if (i >= drops) break;
    float fi = float(i);
    float a = rnd(fi, s + 4.0) * TAU;
    float dist = mix(size * 1.05, 0.92, pow(rnd(fi, s + 5.0), 0.7));
    float rad = mix(0.006, 0.045, pow(rnd(fi, s + 6.0), 3.0)) * (1.2 - dist * 0.6);
    vec2 dir = vec2(cos(a), sin(a));
    vec2 c = dir * dist;
    vec2 d = p - c;
    float along = dot(d, dir), across = dot(d, vec2(-dir.y, dir.x));
    float e = length(vec2(along / (rad * (1.0 + dist * 1.2)), across / rad));
    float drop = smoothstep(1.05, 0.9, e);
    // tail back towards centre
    float tail = smoothstep(rad * 0.5, 0.0, abs(across)) * step(along, 0.0) * smoothstep(-rad * 5.0, 0.0, along) * 0.9;
    cov = max(cov, max(drop, tail));
    thick = max(thick, drop * 0.6);
  }
  return vec4(cov, thick, r / max(Rs, 0.01), 0.0);
}

vec4 decalHeight(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0;
  float s = uVar * 17.0 + float(uKind) * 3.0;
  p = rot(rnd(0.0, s) * TAU) * p;
  vec4 o = vec4(0.0);
  if (uKind == 0) { // blood_splat
    o = splat(p, 0.32 + 0.08 * rnd(1.0, s), 0.9, 26, s);
  } else if (uKind == 1) { // blood_smear: drag towards +x
    vec2 q = p; q.y += 0.12 * fb(vec2(q.x * 0.5, 0.0), 2.0, 2, s);
    float width = 0.32 * (0.7 + 0.3 * sin(q.x * 2.0 + s)) * smoothstep(1.0, -0.3, q.x);
    float band = smoothstep(width, width * 0.6, abs(q.y));
    float strands = vnoise(vec2(q.x * 3.0, q.y * 40.0) + 50.0, vec2(64.0), s + 1.0);
    float fade = smoothstep(0.95, -0.7, q.x + 0.3 * fb(q, 3.0, 3, s + 2.0));
    float cov = band * smoothstep(0.25, 0.55, strands * fade + fade * 0.35);
    vec4 blob = splat(p + vec2(0.62, 0.0), 0.25, 0.25, 6, s + 9.0);
    cov = max(cov, blob.x);
    o = vec4(cov, cov * (0.3 + 0.5 * fade), fade, 0.0);
  } else if (uKind == 2) { // blood_pool
    float r = length(p); float ang = atan(p.y, p.x);
    float R = 0.62 + 0.12 * angNoise(ang, 4.0, s) + 0.06 * angNoise(ang, 11.0, s + 1.0) + 0.04 * fb(p, 4.0, 3, s + 2.0);
    float cov = smoothstep(R + 0.008, R - 0.008, r);
    vec4 sp = splat(p * 1.1 + vec2(0.1, 0.0), 0.2, 0.0, 14, s + 4.0);
    cov = max(cov, sp.x);
    float thick = cov * smoothstep(R, R * 0.5, r);
    o = vec4(cov, max(thick, sp.y * 0.5), r / R, 0.0);
  } else if (uKind == 3) { // oil_stain
    float n = fb(p, 1.6, 5, s);
    float r = length(p * vec2(1.0, 1.2));
    float f = 1.0 - r + 0.35 * n;
    float cov = smoothstep(0.25, 0.55, f);
    o = vec4(cov, cov * 0.3, f, 0.0);
  } else if (uKind == 4) { // oil_drip: streaks running down from the top
    p = (uv - 0.5) * 2.0;
    float cov = 0.0, thick = 0.0;
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float x = mix(-0.6, 0.6, rnd(fi, s + 1.0));
      float len = mix(0.4, 1.7, rnd(fi, s + 2.0));
      float w = mix(0.008, 0.032, rnd(fi, s + 3.0) * rnd(fi, s + 4.0));
      float top = 0.9;
      float y0 = top - len;
      float dx = abs(p.x - x - 0.02 * sin(p.y * 7.0 + fi));
      float taper = mix(1.0, 0.55, sat((top - p.y) / len));
      float stem = smoothstep(w * taper, w * taper * 0.6, dx) * step(y0, p.y) * step(p.y, top);
      float blob = smoothstep(w * 1.6, w * 1.2, length(vec2(dx, (p.y - y0) * 0.8)));
      cov = max(cov, max(stem, blob));
      thick = max(thick, blob * 0.8 + stem * 0.3);
    }
    float src = smoothstep(0.1, -0.05, abs(p.y - 0.9) - 0.02 - 0.05 * fb(p, 5.0, 3, s)) * smoothstep(0.75, 0.3, abs(p.x) + 0.2 * fb(p, 3.0, 3, s + 1.0));
    cov = max(cov, src * 0.85);
    o = vec4(cov, thick, 0.0, 0.0);
  } else if (uKind == 5) { // scorch
    float r = length(p);
    float n = fb(p, 2.5, 6, s);
    float ang = atan(p.y, p.x);
    float rays = pow(sat(angNoise(ang, 23.0, s + 1.0) * 0.7 + 0.4), 2.0);
    float f = 1.0 - r * (1.05 - 0.4 * rays) + 0.3 * n;
    o = vec4(smoothstep(0.0, 0.6, f), smoothstep(0.4, 0.9, f), f, 0.0);
  } else if (uKind == 6) { // bullet_metal
    float r = length(p); float ang = atan(p.y, p.x);
    float hole = smoothstep(0.1, 0.085, r + 0.01 * angNoise(ang, 9.0, s));
    float petal = 0.5 + 0.5 * angNoise(ang, 7.0, s + 1.0);
    float lipR = 0.2 + 0.03 * petal;
    float dent = (1.0 - smoothstep(0.1, 0.45, r)) ;
    float h = 0.5 - 0.35 * dent * dent + 0.25 * exp(-pow((r - lipR) / 0.04, 2.0)) * (0.6 + 0.4 * petal);
    h = mix(h, 0.0, hole);
    float bare = smoothstep(0.32, 0.22, r + 0.04 * fb(p, 6.0, 3, s + 2.0));
    float heat = smoothstep(0.55, 0.3, r + 0.08 * fb(p, 4.0, 3, s + 3.0));
    float streak = pow(sat(angNoise(ang, 40.0, s + 4.0)), 3.0) * smoothstep(0.7, 0.2, r);
    o = vec4(max(heat, streak * 0.6), h, bare, hole);
  } else if (uKind == 7) { // bullet_concrete
    float r = length(p); float ang = atan(p.y, p.x);
    vec3 ve = voronoiEdge(p * 5.0 + 20.0, vec2(64.0), s, 1.0);
    float crR = 0.28 + 0.07 * angNoise(ang, 6.0, s);
    float crater = smoothstep(crR + 0.02, crR - 0.02, r);
    float depthN = (1.0 - r / crR) * 0.7 + 0.3 * ve.y;
    float chunkEdge = 1.0 - smoothstep(0.0, 0.06, ve.x);
    float hole = smoothstep(0.07, 0.05, r);
    float h = 0.6 - crater * (0.35 * depthN + 0.08 * chunkEdge);
    h = mix(h, 0.0, hole);
    float dust = smoothstep(0.75, 0.25, r + 0.2 * fb(p, 3.0, 4, s + 1.0));
    float cracks = 0.0;
    for (int i = 0; i < 5; i++) {
      float a = rnd(float(i), s + 2.0) * TAU; vec2 dir = vec2(cos(a), sin(a));
      float t = dot(p, dir); float d = abs(dot(p, vec2(-dir.y, dir.x)) + 0.03 * nz(p, 9.0, s + float(i)));
      cracks = max(cracks, smoothstep(0.012, 0.0, d) * step(crR * 0.8, t) * smoothstep(0.75, crR, t));
    }
    h -= 0.15 * cracks;
    o = vec4(max(max(crater, dust * 0.85), cracks), h, crater, hole);
  } else if (uKind == 8) { // scratches cluster
    float scr = scratches(uv * 0.999, 5.0, rnd(1.0, s) * PI, 0.5, 0.4, 1.6, 2.0, 0.85, s);
    float scr2 = scratches(uv * 0.999, 9.0, rnd(2.0, s) * PI, 2.5, 0.2, 0.8, 1.4, 0.6, s + 1.0);
    float mask = smoothstep(1.0, 0.3, length(p) + 0.3 * fb(p, 2.0, 3, s));
    float c = max(scr, scr2 * 0.8) * mask;
    o = vec4(smoothstep(0.05, 0.5, c), 0.5 - 0.3 * c, c, 0.0);
  } else if (uKind == 9) { // grime
    float n = fb(p, 1.8, 6, s);
    float r = length(p);
    float f = 1.0 - r + 0.45 * n;
    float cov = smoothstep(0.1, 0.7, f) * (0.6 + 0.4 * fb(p, 7.0, 4, s + 1.0));
    o = vec4(cov, 0.5, f, 0.0);
  } else if (uKind == 10) { // handprint (bloody), slightly dragged downwards
    vec2 q = (uv - 0.5) * 2.0; // keep upright (fingers up), only mirror per variant
    if (rnd(5.0, s) > 0.5) q.x = -q.x;
    q = rot((rnd(6.0, s) - 0.5) * 0.5) * q;
    float d = length((q - vec2(0.0, -0.2)) / vec2(0.34, 0.36)) - 1.0;
    d *= 0.3;
    float fingers = 9.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float bx = -0.23 + fi * 0.155;
      float len = (i == 0 ? 0.42 : i == 3 ? 0.36 : 0.5) + 0.04 * rnd(fi, s);
      float a = (fi - 1.5) * 0.12;
      vec2 base = vec2(bx, 0.05);
      vec2 tip = base + vec2(sin(a), cos(a)) * len;
      fingers = min(fingers, sdSeg(q, base, tip) - 0.06);
    }
    float thumb = sdSeg(q, vec2(0.28, -0.25), vec2(0.58, 0.05)) - 0.07;
    d = min(d, min(fingers, thumb));
    float shape = smoothstep(0.015, -0.015, d + 0.02 * fb(q, 8.0, 3, s));
    // skin-ridge dropouts + uneven blood transfer
    float transfer = smoothstep(0.3, 0.7, fb(q, 4.0, 5, s + 1.0) * 0.5 + 0.5 + 0.12) * (0.7 + 0.3 * smoothstep(-0.5, 0.3, q.y));
    float ridges = 0.9 + 0.1 * sin(length(q - vec2(0.0, 0.2)) * 160.0 + fb(q, 6.0, 2, s) * 6.0);
    float cov = shape * transfer * ridges;
    // drag streaks below
    float drag = smoothstep(0.35, 0.0, abs(q.x) - 0.2) * step(q.y, -0.4) * smoothstep(-1.0, -0.45, q.y);
    drag *= smoothstep(0.4, 0.75, vnoise(vec2(q.x * 30.0, q.y * 2.0) + 40.0, vec2(128.0), s + 2.0));
    cov = max(cov, drag * 0.8);
    o = vec4(cov, cov * 0.4, 0.5, 0.0);
  } else { // water_stain: tide marks
    float r = length(p);
    float n = fb(p, 2.0, 5, s);
    float f = r + 0.25 * n;
    float rings = 0.0;
    for (int i = 0; i < 4; i++) {
      float rr = 0.25 + 0.17 * float(i) + 0.05 * rnd(float(i), s);
      float d = f - rr;
      // tide mark: sharp outer edge, soft inner fade (minerals deposit at the drying front)
      rings = max(rings, (smoothstep(0.012, 0.0, d) * smoothstep(-0.08, 0.0, d)) * (0.8 - float(i) * 0.15));
    }
    float inside = smoothstep(0.85, 0.45, f) * 0.45;
    o = vec4(sat(max(rings, inside)), 0.5, rings, inside);
  }
  o.x *= border(uv);
  return o;
}

vec4 heightFn(vec2 uv) {
  vec4 o = decalHeight(uv);
  float h;
  if (uKind == 6 || uKind == 7) h = o.y;
  else if (uKind == 8) h = o.y;
  else h = 0.5 + o.y * 0.5 * o.x;
  return vec4(h, o.x, o.z, o.w);
}

void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec4 o = decalHeight(uv);
  vec2 p = (uv - 0.5) * 2.0;
  float s = uVar * 17.0 + float(uKind) * 3.0;
  float cov = o.x;
  metal = 0.0;
  if (uKind <= 2 || uKind == 10) { // blood
    float thick = o.y;
    float n = fb(p, 6.0, 4, s + 7.0) * 0.5 + 0.5;
    vec3 fresh = mix(C(0x220101), C(0x3c0404), n);
    vec3 dried = mix(C(0x1a0a05), C(0x2e0f07), n);
    // thin areas dried brown, thick areas wet dark red; coffee-ring rim darker
    float dry = 1.0 - smoothstep(0.1, 0.45, thick);
    if (uKind == 2) dry = smoothstep(0.8, 1.0, o.z) * 0.8;
    float rim = (uKind == 2 ? smoothstep(0.88, 0.99, o.z) : 0.0);
    albedo = mix(fresh, dried, dry);
    albedo = mix(albedo, C(0x160604), rim * 0.7);
    albedo *= 0.75 + 0.35 * smoothstep(0.0, 0.5, 1.0 - thick);
    rough = mix(0.04, 0.55, dry);
    alpha = cov * mix(0.97, 0.85, dry);
  } else if (uKind == 3) { // oil stain
    float f = o.z;
    albedo = mix(C(0x0d0a08), C(0x1a140e), sat(f));
    // faint thin-film sheen at the edge
    float edge = smoothstep(0.55, 0.3, f) * cov;
    albedo += edge * 0.04 * (0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + f * 25.0));
    rough = mix(0.1, 0.4, smoothstep(0.9, 0.3, f));
    alpha = cov * 0.9;
  } else if (uKind == 4) { // oil drip
    albedo = C(0x0e0b08); rough = 0.08; alpha = cov * 0.92;
  } else if (uKind == 5) { // scorch
    float core = o.y;
    float soot = fb(p, 9.0, 4, s + 3.0) * 0.5 + 0.5;
    albedo = mix(C(0x1e1914), C(0x040303), core) * (0.8 + 0.4 * soot);
    rough = 0.95; alpha = cov * mix(0.8, 1.0, core);
  } else if (uKind == 6) { // bullet hole, metal
    float bare = o.z; float hole = o.w;
    vec3 heat = mix(C(0x2a2520), C(0x3a3a48), smoothstep(0.5, 0.25, length(p)));
    albedo = mix(heat, C(0x9a9ea4), bare);
    albedo = mix(albedo, vec3(0.01), hole);
    metal = mix(0.5, 1.0, bare) * (1.0 - hole);
    rough = mix(0.6, 0.28, bare);
    alpha = max(cov * 0.9, max(bare, hole));
  } else if (uKind == 7) { // bullet hole, concrete
    float crater = o.z; float hole = o.w;
    float n = fb(p, 10.0, 3, s + 5.0) * 0.5 + 0.5;
    albedo = mix(C(0x8a857c), C(0xa8a296), n);           // fresh pale concrete dust
    albedo = mix(albedo, C(0x6a665e) * (0.8 + 0.4 * n), crater);
    albedo = mix(albedo, vec3(0.03), hole);
    rough = 0.95;
    alpha = max(cov, hole);
    alpha *= mix(0.75, 1.0, crater);
  } else if (uKind == 8) { // scratches: exposed bright metal
    albedo = C(0xb0b4b8); metal = 1.0; rough = 0.3; alpha = cov;
  } else if (uKind == 9) { // grime
    float n = fb(p, 8.0, 4, s + 2.0) * 0.5 + 0.5;
    albedo = mix(C(0x14110d), C(0x2c241b), n); rough = 0.9; alpha = cov * 0.85;
  } else { // water stain
    albedo = mix(C(0x2e2a24), C(0x8a8274), o.z);
    rough = mix(0.4, 0.8, o.z); alpha = cov * 0.45;
  }
}
`;

export class DecalFactory {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(private baker: Baker, private track: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial) {}

  private def(name: DecalName, variant: number): TexDef {
    const kind = Math.max(0, KINDS.indexOf(name));
    const big = name === 'blood_pool' || name === 'scorch' || name === 'water_stain';
    const depth = name.startsWith('bullet') ? 0.006 : name === 'scratches' ? 0.0005 : 0.0015;
    return {
      key: `decal:${name}:${variant}`, size: big ? 512 : 256, tile: big ? 1.0 : 0.3, depth, glsl: GLSL_DECAL,
      uniforms: { uKind: { value: kind }, uVar: { value: variant } }, seed: 40 + variant, clamp: true,
      aoRadius: 0.004, aoStrength: 0.6,
    };
  }

  bakeAll() {
    for (const k of KINDS) for (let v = 0; v < DECAL_VARIANTS; v++) this.get(k, v);
  }

  get(name: DecalName, variant = 0): THREE.MeshStandardMaterial {
    if (!KINDS.includes(name)) { console.warn(`[materials] unknown decal "${name}"`); name = 'grime'; }
    const v = ((Math.floor(variant) % DECAL_VARIANTS) + DECAL_VARIANTS) % DECAL_VARIANTS;
    const key = `${name}:${v}`;
    let m = this.cache.get(key);
    if (m) return m;
    const tex = this.baker.bake(this.def(name, v));
    m = new THREE.MeshStandardMaterial({
      name: `decal_${name}_${v}`,
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.orm, metalnessMap: tex.orm,
      roughness: 1, metalness: 1,
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.track(m);
    this.cache.set(key, m);
    return m;
  }
}
