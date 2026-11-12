/**
 * Viewmodel-only lighting. The weapon and hands must read as a lit, detailed object even in a pitch-black room,
 * without a real light that would also glow on nearby walls (and without spending light-pool slots). So the
 * viewmodel's private material clones get two extra view-space directional terms evaluated with the normal
 * PBR BRDF: a soft side key (dark-adapted eyes / lamp bounce) and a cool kicker from above-ahead whose
 * reflection off top surfaces comes back to the eye (sheen along the slide, knuckles, sleeve folds).
 * World lights from the light manager still add on top. Levels follow the flashlight (off / on); hue and amount
 * follow the room (see setVmRoom — fed by the weapon logic from the pooled lights around the player).
 */
import * as THREE from 'three';

export const VM_LIGHT = {
  keyDir: new THREE.Vector3(-0.86, 0.22, 0.46).normalize(),
  rimDir: new THREE.Vector3(0.3, 0.34, -0.89).normalize(),
  keyColor: new THREE.Color(0.9, 0.89, 0.85),
  rimColor: new THREE.Color(0.55, 0.68, 0.95),
  /** Irradiance (lamp off, lamp on). */
  key: [4.2, 5.4] as [number, number],
  rim: [0.65, 0.95] as [number, number],
};

const U = {
  uVmKey: { value: new THREE.Vector3() },
  uVmKeyDir: { value: VM_LIGHT.keyDir },
  uVmRim: { value: new THREE.Vector3() },
  uVmRimDir: { value: VM_LIGHT.rimDir },
};

/**
 * The room around the player: linear RGB of what its lights throw at the surroundings + at the eye (smoothed), and
 * how much of that reaches the hands directly. The synthetic fill stands in for the bounce light the engine does
 * not compute: neutral and low in real darkness (dark-adapted eyes), and in a lit room it takes the room's hue
 * and rises with it — red under emergency lamps, warm in the fab hall — easing off where real lights already
 * hit the hands.
 */
const room = new THREE.Color(0, 0, 0);
let roomDirect = 0;
let lastLevel = 0, lastScale = 1;
export function setVmRoom(r: number, g: number, b: number, direct: number, k = 1) {
  room.r += (r - room.r) * k; room.g += (g - room.g) * k; room.b += (b - room.b) * k;
  roomDirect += (direct - roomDirect) * k;
  setVmLight(lastLevel, lastScale);
}
/** Debug: current room estimate. */
export function vmRoom() { return { rgb: room.toArray(), direct: roomDirect, key: U.uVmKey.value.toArray(), rim: U.uVmRim.value.toArray() }; }

/** `level` 0 = flashlight off, 1 = on (smoothed by the caller). `scale` dims everything (e.g. harness). */
export function setVmLight(level: number, scale = 1) {
  lastLevel = level; lastScale = scale;
  const L = VM_LIGHT;
  const e = Math.max(room.r, room.g, room.b);
  const tw = Math.min(1, e / 0.35) * 0.8;
  const inv = e > 1e-5 ? 1 / e : 0;
  const tr = 1 + (room.r * inv - 1) * tw, tg = 1 + (room.g * inv - 1) * tw, tb = 1 + (room.b * inv - 1) * tw;
  // a saturated hue carries less luminance: lift it so tinted hands do not read darker than neutral ones
  const lum = Math.max(0.3, 0.3 * tr + 0.55 * tg + 0.15 * tb);
  const amount = (1 + 0.5 * Math.min(e, 6)) * (1 - 0.5 * Math.min(1, roomDirect / 5)) * Math.min(2.2, 1 / lum) * scale;
  const k = (L.key[0] + (L.key[1] - L.key[0]) * level) * amount, r = (L.rim[0] + (L.rim[1] - L.rim[0]) * level) * amount;
  U.uVmKey.value.set(L.keyColor.r * k * tr, L.keyColor.g * k * tg, L.keyColor.b * k * tb);
  const rw = 0.8;
  U.uVmRim.value.set(L.rimColor.r * r * (1 + (tr - 1) * rw), L.rimColor.g * r * (1 + (tg - 1) * rw), L.rimColor.b * r * (1 + (tb - 1) * rw));
}
setVmLight(0);
if ((import.meta as any).env?.DEV) (globalThis as any).__vmRoom = vmRoom;

const PARS = /* glsl */ `
uniform vec3 uVmKey; uniform vec3 uVmKeyDir; uniform vec3 uVmRim; uniform vec3 uVmRimDir;
`;
const TERM = /* glsl */ `
{
  IncidentLight vmL;
  vmL.visible = true;
  vmL.color = uVmKey; vmL.direction = uVmKeyDir;
  RE_Direct( vmL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  vmL.color = uVmRim; vmL.direction = uVmRimDir;
  RE_Direct( vmL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
`;

/** Add the viewmodel light terms to a private MeshStandardMaterial clone (chains any existing shader patch). */
export function litForViewmodel<T extends THREE.Material>(mat: T): T {
  if (!(mat as unknown as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + TERM);
  };
  mat.customProgramCacheKey = function (this: THREE.Material) { return prevKey.call(this) + '|vmlight'; };
  mat.needsUpdate = true;
  return mat;
}
