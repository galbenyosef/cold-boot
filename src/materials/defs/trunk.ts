/**
 * Stage 3d trunk / moon-pool dock set (docs/plans/stage-3d.md §8.8). Same contract as the other bodies: `heightFn`
 * (height + masks) and `surf`, tileable over the tile, authored in metres (`uv * uTile`). Baked at load from level
 * `TRUNK_FROM` (6) on, elsewhere on first `get` (dev pages).
 *
 * A cable trunk and a moon-pool dock 2.1 km down: wet sprayed-concrete tunnel lining with lime bloom, the trunk
 * cable's galvanised wire armour in bitumen, heavy dock plate worn to bright steel on the walk lines (dry, and the
 * wet-dock variant `dock_steel_wet`), the loader's chipped crane yellow, greased six-strand wire rope, corrugated
 * containers (navy, orange) and the contractors' orange coveralls.
 *
 * UV conventions (metre UVs, 1 UV unit = 1 m): walls / plates v up; cylinders (CylinderGeometry with `metreUV`) u
 * AROUND the circumference, v ALONG the axis — `cable_armour` and `rope_wire` lay their helix that way. `rope_wire` is
 * exact on a 38 mm rope (circumference 0.12 m = 6 strands × 20 mm); other diameters show one strand seam along the rope.
 * Containers: corrugation ridges run along v (vertical on a side wall), pitch 0.28 m (8 per 2.24 m tile).
 *
 * Rules carried from 3b / 3c: albedos ≤ ~0.85 sRGB, no stacked darkening, nothing near-black (the darkest albedo —
 * bitumen, rope grease — stays ≥ 0.11 sRGB so a red emergency point still draws it), the life of large flat panels in
 * roughness and the normal rather than low-frequency albedo mottle.
 */
import * as THREE from 'three';
import type { TrunkMaterialName } from '../../core/types';
import type { MatSpec } from './index';

/**
 * Look extras the contract's `TrunkMaterialName` does not name: full library materials
 * (`materials.get('dock_steel_wet' as MaterialName)`) until `core/types.ts` lists them.
 */
export const TRUNK_EXTRAS = ['dock_steel_wet'] as const;
export type TrunkExtraName = typeof TRUNK_EXTRAS[number];

/**
 * tunnel_shotcrete: sprayed concrete on a 3 m tile — the rebound's lumpy undulation (~1 m), aggregate nodules
 * (~10 mm), spray-pass ridges, fine grit. Seepage: vertical wet streaks (darker, glossy) with lime efflorescence
 * crusting along them. v is up the wall (streaks fall along −v).
 */
export const SHOTCRETE = /* glsl */ `
uniform vec3 uCol; uniform float uWet;
vec4 heightFn(vec2 uv) {
  // the rebound: broad undulation (~1 m) and the lumps of each pass (~0.2 m), then the nodules and grit
  float h = 0.45 + 0.2 * fbm(uv, vec2(3.0), 4, 0.5, 1.0);
  float lump = fbm(uv, vec2(14.0), 3, 0.5, 2.0);
  h += 0.12 * lump;
  float N = floor(uTile * 90.0);
  vec3 w = worley(uv * N, vec2(N), 3.0);
  float nod = dome(w.x, 0.55) * step(0.35, w.z);
  h += 0.06 * nod;
  float N2 = floor(uTile * 380.0);
  h += 0.02 * gnoise(uv * N2, vec2(N2), 4.0);
  // seepage: a few streaks below wet sources, soft-edged, long along v
  float st = streakNoise(uv, 12.0, 1.0, 5.0);
  float src = fbm01(uv, vec2(3.0, 2.0), 4, 0.5, 6.0);
  float wet = smoothstep(0.68, 0.92, st * 0.6 + src * 0.55) * uWet;
  // lime bloom: a crust on the streaks' margins, broken up
  float margin = smoothstep(0.08, 0.3, wet) * (1.0 - smoothstep(0.45, 0.8, wet));
  float eff = margin * smoothstep(0.5, 0.75, fbm01(uv, vec2(18.0), 4, 0.6, 7.0));
  h += 0.03 * eff;
  return vec4(h, nod, wet, eff);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float pass = fbm01(uv, vec2(3.0), 4, 0.5, 11.0);
  vec3 c = uCol * (0.92 + 0.12 * pass);
  // the aggregate a touch warmer and lighter than the paste
  c = mix(c, uCol * vec3(1.08, 1.04, 0.98), H.g * 0.5);
  float speck = h1(ivec2(uv * floor(uTile * 380.0)), 9.0);
  c *= 0.95 + 0.1 * speck;
  rough = 0.92 - 0.04 * H.g;
  // wet: darker paste, a glossy core
  float wet = H.b;
  c *= 1.0 - 0.2 * smoothstep(0.0, 0.8, wet);
  rough = mix(rough, 0.4, smoothstep(0.15, 0.8, wet));
  rough = mix(rough, 0.2, smoothstep(0.85, 1.0, wet));
  // efflorescence: chalky off-white crust, dry and rough
  c = mix(c, C(0xcbc9be), H.a * 0.45);
  rough = mix(rough, 0.97, H.a);
  albedo = c * mix(0.72, 1.0, D.x);
  metal = 0.0;
}
`;

/**
 * cable_armour: 40 galvanised wires of 5 mm per 0.2 m of circumference, helical lay (13 wires' shift per tile along
 * the axis: ≈ 18° to the axis), the gaps flooded with bitumen compound that also smears the crowns; dull zinc with
 * white bloom where damp, a few brown rust spots. u = around, v = along.
 */
export const CABLE_ARMOUR = /* glsl */ `
vec4 heightFn(vec2 uv) {
  float p = uv.x * 40.0 + uv.y * 13.0;
  float f = fract(p) - 0.5;
  float wire = sqrt(max(0.0, 1.0 - 4.0 * f * f));
  float tar = smoothstep(0.62, 0.8, fbm01(uv, vec2(3.0, 6.0), 5, 0.55, 2.0));
  float h = 0.15 + 0.8 * pow(wire, 0.7);
  // compound fills the gaps (raises the valleys), and a smear lies over the crowns where it is thick
  h = max(h, 0.32 + 0.4 * tar);
  float N = floor(uTile * 500.0);
  h += 0.02 * gnoise(uv * N, vec2(N), 3.0);
  float bloom = smoothstep(0.6, 0.8, fbm01(uv, vec2(5.0), 5, 0.6, 4.0));
  return vec4(h, wire, tar, bloom);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float p = uv.x * 40.0 + uv.y * 13.0;
  float id = h1(ivec2(int(mod(floor(p), 40.0)), 0), 5.0);
  float wire = H.g;
  float onWire = smoothstep(0.2, 0.6, wire);
  vec3 zinc = vec3(0.6, 0.62, 0.63) * (0.86 + 0.18 * id) * (0.92 + 0.12 * fbm01(uv, vec2(4.0), 3, 0.5, 6.0));
  vec3 c = zinc; rough = 0.42 + 0.1 * id; metal = 0.78;
  // crowns polished a little brighter
  c = mix(c, vec3(0.72, 0.74, 0.75), smoothstep(0.85, 1.0, wire) * 0.35);
  // bitumen in the valleys and as smears (glossy, dark brown — not black)
  float tar = max(1.0 - onWire, H.b);
  c = mix(c, C(0x2c2721), tar * 0.92); rough = mix(rough, 0.3, tar); metal = mix(metal, 0.0, tar);
  // white zinc bloom (chalky, dielectric) on exposed zinc
  float b = H.a * (1.0 - tar);
  c = mix(c, vec3(0.76, 0.76, 0.73), b * 0.6); rough = mix(rough, 0.88, b * 0.7); metal *= 1.0 - b * 0.8;
  float rs = smoothstep(0.72, 0.86, fbm01(uv, vec2(12.0), 5, 0.6, 8.0)) * onWire;
  c = mix(c, C(0x7a4826), rs * 0.8); rough = mix(rough, 0.85, rs); metal *= 1.0 - rs;
  albedo = c * mix(0.75, 1.0, D.x);
}
`;

/**
 * rope_wire: six-strand wire rope, ordinary lay — strands at ≈ 27° one way, their outer wires at 45° the other;
 * greased: dark grease packed in the strand valleys and smeared over, the crowns wiped bright where the rope ran over
 * sheaves. 0.04 m tile = 2 strands across (exact on a 38 mm rope), 1 lay step along. u = around, v = along.
 */
export const ROPE_WIRE = /* glsl */ `
vec4 heightFn(vec2 uv) {
  float ps = uv.x * 2.0 + uv.y;
  float fs = fract(ps);
  float strand = pow(sin(fs * PI), 0.55);
  float pw = (uv.x - uv.y) * 18.0;
  float fw = fract(pw) - 0.5;
  float wire = sqrt(max(0.0, 1.0 - 4.0 * fw * fw));
  float h = strand * (0.72 + 0.28 * pow(wire, 0.8));
  float grease = smoothstep(0.45, 0.75, fbm01(uv, vec2(2.0, 4.0), 4, 0.55, 3.0));
  // packed grease fills the valleys
  h = max(h, 0.18 + 0.25 * grease);
  float N = floor(uTile * 900.0);
  h += 0.02 * gnoise(uv * N, vec2(N), 5.0);
  return vec4(h, strand, wire, grease);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float crown = smoothstep(0.75, 0.98, H.g) * smoothstep(0.4, 0.9, H.b);
  vec3 steel = vec3(0.5, 0.52, 0.53) * (0.9 + 0.12 * fbm01(uv, vec2(4.0), 3, 0.5, 9.0));
  vec3 c = steel; rough = 0.4; metal = 0.85;
  // grease: valleys always, a film over most of the crowns
  float valley = 1.0 - smoothstep(0.35, 0.75, H.g);
  float film = H.a * (1.0 - crown * 0.8);
  float gr = max(valley, film * 0.85);
  c = mix(c, C(0x3b3125), gr); rough = mix(rough, 0.22, gr); metal = mix(metal, 0.15, gr);
  // wiped crowns: bright steel
  c = mix(c, vec3(0.7, 0.71, 0.72), crown * (1.0 - H.a * 0.6) * 0.8); rough = mix(rough, 0.28, crown * 0.6);
  float rs = smoothstep(0.75, 0.88, fbm01(uv, vec2(8.0), 4, 0.6, 12.0)) * (1.0 - gr);
  c = mix(c, C(0x6e4224), rs * 0.7); rough = mix(rough, 0.8, rs); metal *= 1.0 - rs;
  albedo = c * mix(0.7, 1.0, D.x);
}
`;

/**
 * dock_steel: heavy deck plate, 2 × 2 m plates with ground-flush butt welds (staggered by a metre), thick grey-green
 * deck paint worn through to the red oxide primer and then to bright, scratched steel along the walk lines (elongated
 * along v), pitting, oil. `uWet` (the wet-dock variant): standing water in the plates' shallow dishing (glass-smooth,
 * darker) and a damp sheen everywhere.
 */
export const DOCK_STEEL = /* glsl */ `
uniform vec3 uCol; uniform float uWet;
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float row = floor(m.y / 2.0);
  float bx = abs(mod(m.x + mod(row, 2.0) + 1.0, 2.0) - 1.0);
  float by = abs(mod(m.y + 1.0, 2.0) - 1.0);
  float seam = min(bx, by);
  float weld = dome(seam, 0.009) * (0.85 + 0.15 * sin((bx < by ? m.y : m.x) * TAU / 0.008));
  // plates dish a little between their stiffeners (the puddles collect here)
  float dish = fbm(uv, vec2(2.0), 3, 0.5, 1.0);
  float h = 0.5 + 0.08 * dish;
  // the walk lanes (long along v), where the paint is gone
  float lane = smoothstep(0.42, 0.68, fbm01(uv, vec2(3.0, 1.0), 4, 0.55, 2.0));
  vec2 chip = chipMask(uv, 16.0, 0.0, -0.17 + 0.36 * lane, 3.0);
  h -= 0.05 * chip.x + 0.04 * chip.y;
  float scr = scratches(uv, 16.0, 1.5708, 0.6, 0.3, 1.4, 1.4, 0.7 * lane + 0.2, 4.0);
  h -= 0.03 * scr;
  float N = floor(uTile * 60.0);
  vec3 w = worley(uv * N, vec2(N), 5.0);
  float pit = smoothstep(0.25, 0.0, w.x) * step(0.82, w.z) * chip.y;
  h -= 0.06 * pit;
  h += 0.12 * weld;
  // the seam welds show as a darker line in every state
  return vec4(h, chip.x, chip.y, max(scr, pit));
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float lane = smoothstep(0.42, 0.68, fbm01(uv, vec2(3.0, 1.0), 4, 0.55, 2.0));
  float mott = fbm01(uv, vec2(5.0), 4, 0.5, 11.0);
  float row = floor(m.y / 2.0);
  float pid = h1(ivec2(int(floor((m.x + mod(row, 2.0)) / 2.0)), int(row)), 3.0);
  vec3 paint = uCol * (0.97 + 0.04 * (pid - 0.5) + 0.06 * (mott - 0.5));
  // the paint thins and greys in the lanes before it goes
  paint = mix(paint, mix(paint, vec3(luma(paint)), 0.4) * 1.12, lane * 0.6);
  vec3 primer = C(0x7c4a34) * (0.9 + 0.15 * mott);
  // (bare steel kept part-diffuse so it still reads in the dark and does not go black in a dim probe)
  vec3 steel = vec3(0.6, 0.6, 0.59) * (0.92 + 0.1 * mott);
  vec3 c = mix(paint, primer, H.g);
  c = mix(c, steel, H.b);
  rough = mix(0.6 + 0.1 * mott - 0.12 * lane, 0.66, H.g);
  rough = mix(rough, 0.4, H.b);
  metal = H.b * 0.55;
  // boot scuffs: dark rubber marks in the lanes
  float scuff = smoothstep(0.6, 0.8, fbm01(uv, vec2(24.0, 12.0), 3, 0.5, 21.0)) * lane;
  c = mix(c, C(0x2c2d2c), scuff * 0.3);
  // scratches: bright lines in worn steel, pale lines in the paint
  float sc = smoothstep(0.1, 0.6, H.a);
  c = mix(c, mix(paint * 1.3, vec3(0.7, 0.71, 0.72), H.b), sc * 0.5); rough = mix(rough, 0.3, sc * H.b);
  // rust in the pits and round the worn edges
  float rn = fbm01(uv, vec2(18.0), 4, 0.55, 13.0);
  float rust = H.b * smoothstep(0.6, 0.85, rn) * 0.5 + smoothstep(0.45, 0.0, D.x) * H.b * 0.25;
  c = mix(c, mix(C(0x5c2e18), C(0x8c4c26), rn), sat(rust)); rough = mix(rough, 0.85, sat(rust)); metal *= 1.0 - sat(rust);
  // oil: dark, smooth stains
  float oil = smoothstep(0.66, 0.8, warped(uv, vec2(4.0), 4, 0.8, 14.0));
  c = mix(c, c * 0.45 + C(0x1c1a16) * 0.25, oil * 0.75); rough = mix(rough, 0.2, oil * 0.8);
  float g = grimeAmount(uv, D, 0.35, 19.0);
  c = mix(c, C(0x34332e), g * 0.4);
  // wet variant: damp sheen everywhere, standing water in the dishing (where the paint sits lowest)
  float pud = smoothstep(-0.05, -0.25, fbm(uv, vec2(2.0), 3, 0.5, 1.0)) * uWet;
  c *= 1.0 - 0.12 * uWet - 0.12 * pud;
  rough = mix(rough, rough * 0.55, uWet);
  rough = mix(rough, 0.04, pud);
  albedo = c * mix(0.8, 1.0, D.x);
}
`;

/**
 * crane_yellow: crane yellow on structural steel — heavy chipping at edges and knocks, through the grey primer to
 * rusty steel (red oxide rims); rust streaks hanging below the bare patches; sparse grease drips. v up.
 */
export const CRANE_YELLOW = /* glsl */ `
uniform vec3 uCol; uniform float uWear;
vec4 heightFn(vec2 uv) {
  float h = 0.5 + 0.03 * fbm(uv, vec2(3.0), 4, 0.5, 1.0);
  float N = floor(uTile * 140.0);
  h += 0.008 * gnoise(uv * N, vec2(N), 2.0);
  vec2 chip = chipMask(uv, 7.0, 0.0, -0.16 + uWear * 0.14, 3.0);
  // knocks: small dense chip clusters
  float knock = smoothstep(0.7, 0.85, fbm01(uv, vec2(6.0), 5, 0.6, 4.0));
  vec2 chip2 = chipMask(uv, 22.0, 0.0, -0.2 + 0.3 * knock, 5.0);
  vec2 ch = max(chip, chip2);
  h -= 0.06 * ch.x + 0.05 * ch.y;
  float scr = scratches(uv, 10.0, 0.0, 3.0, 0.2, 1.0, 1.2, 0.35, 6.0);
  h -= 0.02 * scr;
  return vec4(h, ch.x, ch.y, scr);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float mott = fbm01(uv, vec2(4.0), 4, 0.5, 11.0);
  vec3 paint = uCol * (0.95 + 0.08 * mott);
  vec3 primer = C(0x86533a) * (0.9 + 0.15 * mott);
  float rn = fbm01(uv, vec2(20.0), 4, 0.55, 13.0);
  vec3 steel = mix(C(0x4e2a18), C(0x6a4a34), smoothstep(0.5, 0.7, rn));
  vec3 c = mix(paint, primer, H.g);
  c = mix(c, steel, H.b);
  rough = mix(0.48 + 0.08 * mott, 0.62, H.g);
  rough = mix(rough, 0.78, H.b);
  metal = H.b * smoothstep(0.5, 0.7, rn) * 0.7;
  float sc = smoothstep(0.1, 0.6, H.a);
  c = mix(c, primer, sc * 0.5);
  // rust streaks below the bare patches (columns 18 / m, short)
  float st = streakNoise(uv, 36.0, 3.0, 15.0) * smoothstep(0.55, 0.85, fbm01(uv, vec2(5.0), 4, 0.5, 16.0));
  c = mix(c, C(0x8a4a24), smoothstep(0.55, 0.85, st) * 0.35);
  // grease drips and a dirt wash below the flange at the top of each 2 m
  float dr = dripsBelow(m, 2.0 - 0.02, 4.0, 1.4, 17.0) * smoothstep(0.4, 0.6, fbm01(uv, vec2(3.0, 1.0), 2, 0.5, 18.0));
  c = mix(c, C(0x4a3c28), dr * 0.6); rough = mix(rough, 0.25, dr);
  float g = grimeAmount(uv, D, 0.45, 19.0);
  c = mix(c, C(0x3c3628), g * 0.45);
  albedo = c * mix(0.82, 1.0, D.x);
}
`;

/**
 * container_navy / container_orange: ISO container side sheet — trapezoidal corrugation (pitch 0.28 m, 36 mm deep:
 * 70 mm outer face, 70 mm webs, 70 mm inner face), dents, the paint scuffed off the outer faces in horizontal scrapes,
 * rust blooming from the dents and bleeding down the inner faces, salt-damp grime. Ridges run along v.
 */
export const CONTAINER = /* glsl */ `
uniform vec3 uCol; uniform float uWear;
float corr(float x) {
  float f = fract(x / 0.28) * 4.0;   // 0..1 outer, 1..2 web down, 2..3 inner, 3..4 web up
  if (f < 1.0) return 1.0;
  if (f < 2.0) return 1.0 - smoothstep(0.0, 1.0, f - 1.0);
  if (f < 3.0) return 0.0;
  return smoothstep(0.0, 1.0, f - 3.0);
}
vec4 heightFn(vec2 uv) {
  vec2 m = uv * uTile;
  float c = corr(m.x + 0.035);
  float h = 0.08 + 0.8 * c;
  // dents: broad shallow pushes
  float dent = fbm(uv, vec2(2.0, 1.0), 4, 0.55, 1.0);
  h += 0.07 * dent;
  float N = floor(uTile * 120.0);
  h += 0.006 * gnoise(uv * N, vec2(N), 2.0);
  // horizontal scrapes (forklift tines, other boxes) on the outer faces
  float scr = scratches(uv, 8.0, 0.0, 0.25, 0.4, 1.6, 1.6, 0.45 + 0.3 * uWear, 3.0) * smoothstep(0.6, 0.95, c);
  vec2 chip = chipMask(uv, 10.0, 0.0, -0.2 + 0.2 * uWear, 4.0);
  h -= 0.02 * scr + 0.02 * chip.x;
  float dentRust = smoothstep(0.35, 0.6, abs(dent)) * smoothstep(0.55, 0.75, fbm01(uv, vec2(12.0), 4, 0.55, 5.0));
  return vec4(h, c, max(scr, chip.x), dentRust);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  vec2 m = uv * uTile;
  float mott = fbm01(uv, vec2(3.0), 4, 0.5, 11.0);
  vec3 paint = uCol * (0.95 + 0.08 * mott);
  // faded on the outer faces, a touch deeper on the inner
  paint = mix(paint * 0.94, mix(paint, vec3(luma(paint)), 0.1) * 1.05, H.g);
  vec3 c = paint;
  rough = 0.55 + 0.08 * mott;
  float sc = smoothstep(0.1, 0.6, H.b);
  vec3 bare = mix(C(0x7a4a2c), C(0x6c6e6e), smoothstep(0.5, 0.7, fbm01(uv, vec2(24.0), 3, 0.5, 12.0)));
  c = mix(c, bare, sc * 0.85); rough = mix(rough, 0.6, sc); metal = sc * 0.4;
  // rust from the dents, and bleeding down the inner faces
  float run = streakNoise(uv, 16.0, 2.0, 13.0) * (1.0 - H.g);
  float rust = max(H.a, smoothstep(0.6, 0.85, run) * (0.4 + 0.6 * uWear));
  c = mix(c, mix(C(0x5a2a16), C(0x9a5428), fbm01(uv, vec2(16.0), 3, 0.5, 14.0)), rust * 0.75);
  rough = mix(rough, 0.82, rust); metal *= 1.0 - rust;
  // salt-damp grime in the inner faces' corners
  float g = grimeAmount(uv, D, 0.4, 19.0) + (1.0 - H.g) * 0.12;
  c = mix(c, C(0x2e302e), sat(g) * 0.35);
  albedo = c * mix(0.78, 1.0, D.x);
}
`;

/**
 * coverall_orange: poly-cotton twill (2/1, 45° ribs) in contractor orange — washed-out at the folds, oil and grease
 * smears, grey-brown floor grime, and darker dried stains (the bodies: brown, never red-bright).
 */
export const COVERALL = /* glsl */ `
uniform vec3 uCol;
vec4 heightFn(vec2 uv) {
  float n = 140.0;
  vec2 p = uv * n; vec2 c = floor(p); vec2 f = fract(p);
  float k = mod(c.x + c.y, 3.0);
  float warpUp = step(k, 1.5);
  float warp = pow(sin(f.x * PI), 0.55);
  float weft = pow(sin(f.y * PI), 0.55);
  float h = (warpUp > 0.5 ? warp : weft) * 0.75;
  float fib = gnoise(uv * vec2(n * 0.7, n * 4.0), vec2(n * 0.7, n * 4.0), 1.0);
  h += 0.06 * fib;
  // creases: soft long folds
  float fold = fbm(uv, vec2(2.0, 3.0), 4, 0.55, 3.0);
  h += 0.18 * fold;
  float stain = smoothstep(0.62, 0.78, warped(uv, vec2(3.0), 4, 0.9, 4.0));
  return vec4(h, warpUp, fold, stain);
}
void surf(vec2 uv, vec4 H, vec4 D, inout vec3 albedo, inout float rough, inout float metal, inout float alpha, inout vec3 emis) {
  float n = 140.0;
  vec2 c2 = floor(uv * n);
  float yw = h1(ivec2(int(c2.x), 1), 5.0), yf = h1(ivec2(1, int(c2.y)), 6.0);
  vec3 col = uCol * (H.g > 0.5 ? 0.86 : 1.02) * (0.96 + 0.06 * (H.g > 0.5 ? yw : yf));
  // worn pale on the crease crowns
  col = mix(col, mix(col, vec3(luma(col)), 0.25) * 1.08, smoothstep(0.2, 0.6, H.b) * 0.35);
  // floor grime
  float g = fbm01(uv, vec2(4.0), 5, 0.55, 8.0);
  col = mix(col, C(0x5c5448), smoothstep(0.55, 0.85, g) * 0.45);
  // oil smears
  float oil = smoothstep(0.7, 0.85, fbm01(uv, vec2(6.0), 4, 0.6, 9.0));
  col = mix(col, C(0x3a3026), oil * 0.6);
  // dried stains: dark brown
  col = mix(col, C(0x4a2a1c), H.a * 0.55);
  albedo = col * mix(0.6, 1.0, D.x);
  rough = mix(0.88, 0.7, oil); metal = 0.0;
}
`;

/** Uniform colours are authored as raw sRGB triplets (the bake shader linearises at the end). */
const srgb = (hex: number) => { const c = new THREE.Color(); c.setHex(hex, THREE.LinearSRGBColorSpace); return new THREE.Vector3(c.r, c.g, c.b); };
const HERO = 1024;
const MINOR = 512;

/**
 * The trunk set's specs. 4 × 1024² (shotcrete, dock steel dry / wet, crane yellow) + 5 × 512² (cable armour, rope,
 * two containers, coveralls): ≈ 85 MiB on high, every 1024² baked at 512² on low (≈ 40 MiB).
 */
export const TRUNK_SPECS: Record<TrunkMaterialName | TrunkExtraName, MatSpec> = {
  tunnel_shotcrete: {
    tex: { size: HERO, tile: 3, depth: 0.03, glsl: SHOTCRETE, seed: 101, aoRadius: 0.03,
      uniforms: { uCol: { value: srgb(0x8e8b84) }, uWet: { value: 1 } } },
    params: {}, env: 0.7, macro: [0.12, 0.25], trunk: true,
  },
  cable_armour: {
    tex: { size: MINOR, tile: 0.2, depth: 0.006, glsl: CABLE_ARMOUR, seed: 102, aoRadius: 0.004 },
    params: {}, env: 1.0, macro: [0.08, 0.2], trunk: true,
  },
  dock_steel: {
    tex: { size: HERO, tile: 4, depth: 0.008, glsl: DOCK_STEEL, seed: 103, aoRadius: 0.01,
      uniforms: { uCol: { value: srgb(0x5f6a66) }, uWet: { value: 0 } } },
    params: {}, env: 0.9, macro: [0.08, 0.25], trunk: true,
  },
  dock_steel_wet: {   // extra: the wet dock's floor and the coaming top (same plates, standing water, damp sheen)
    tex: { size: HERO, tile: 4, depth: 0.008, glsl: DOCK_STEEL, seed: 104, aoRadius: 0.01,
      uniforms: { uCol: { value: srgb(0x5f6a66) }, uWet: { value: 1 } } },
    params: {}, env: 1.3, macro: [0.08, 0.3], trunk: true,
  },
  crane_yellow: {
    tex: { size: HERO, tile: 2, depth: 0.004, glsl: CRANE_YELLOW, seed: 105, aoRadius: 0.008,
      uniforms: { uCol: { value: srgb(0xd4a21c) }, uWear: { value: 0.85 } } },
    params: {}, env: 0.9, macro: [0.1, 0.2], trunk: true,
  },
  rope_wire: {
    tex: { size: MINOR, tile: 0.04, depth: 0.004, glsl: ROPE_WIRE, seed: 106, aoRadius: 0.002 },
    params: {}, env: 1.0, trunk: true,
  },
  container_navy: {
    tex: { size: MINOR, tile: 2.24, depth: 0.04, glsl: CONTAINER, seed: 107, aoRadius: 0.02,
      uniforms: { uCol: { value: srgb(0x2c3d58) }, uWear: { value: 0.5 } } },
    params: {}, env: 0.8, macro: [0.1, 0.2], trunk: true,
  },
  container_orange: {
    tex: { size: MINOR, tile: 2.24, depth: 0.04, glsl: CONTAINER, seed: 108, aoRadius: 0.02,
      uniforms: { uCol: { value: srgb(0xc25a1c) }, uWear: { value: 0.7 } } },
    params: {}, env: 0.8, macro: [0.1, 0.2], trunk: true,
  },
  coverall_orange: {
    tex: { size: MINOR, tile: 0.25, depth: 0.0015, glsl: COVERALL, seed: 109, aoRadius: 0.003, uniforms: { uCol: { value: srgb(0xd8601e) } } },
    params: {}, env: 0.3, macro: [0.08, 0.0], trunk: true,
  },
};
