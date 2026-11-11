/**
 * Viewmodel-only lighting. The weapon and hands must read as a lit, detailed object even in a pitch-black room,
 * without a real light that would also glow on nearby walls (and without spending light-pool slots). So the
 * viewmodel's private material clones get two extra view-space directional terms evaluated with the normal
 * PBR BRDF: a soft side key (dark-adapted eyes / lamp bounce) and a cool kicker from above-ahead whose
 * reflection off top surfaces comes back to the eye (sheen along the slide, knuckles, sleeve folds).
 * World lights from the light manager still add on top. Levels follow the flashlight (off / on).
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

/** `level` 0 = flashlight off, 1 = on (smoothed by the caller). `scale` dims everything (e.g. harness). */
export function setVmLight(level: number, scale = 1) {
  const L = VM_LIGHT;
  const k = (L.key[0] + (L.key[1] - L.key[0]) * level) * scale, r = (L.rim[0] + (L.rim[1] - L.rim[0]) * level) * scale;
  U.uVmKey.value.set(L.keyColor.r * k, L.keyColor.g * k, L.keyColor.b * k);
  U.uVmRim.value.set(L.rimColor.r * r, L.rimColor.g * r, L.rimColor.b * r);
}
setVmLight(0);

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
