import * as THREE from 'three';

let patched = false;

/**
 * Global three.js shader-chunk patches (applied once, before any program is compiled):
 *
 * 1. Skip the BRDF for pool lights that do not reach the fragment (`directLight.visible == false`).
 *    The pool keeps ~20 lights bound at all times; most fragments are touched by 2–4 of them.
 * 2. Only hemisphere light #0 is a real light. #1..#3 are "data lights" owned by the render module:
 *    their colour uniforms carry the reflection-probe room boxes (the only per-frame *global* uniforms
 *    three.js offers to built-in materials).
 * 3. Image-based lighting is weighted by those boxes, so a room's reflection probe does not light the
 *    dark room you can see through its doorway.
 * 4. Hemisphere lights #4.. are one data light per pool slot (spots first, then points, in pool order):
 *    skyColor = centre, groundColor = half extents of the slot's `LightDesc.bounds` (already shrunk by
 *    LIGHT_BOX_EDGE). Outside that box the light fades to nothing over LIGHT_BOX_EDGE metres, so lights
 *    that have no shadow map do not shine through walls.
 */
/** First hemisphere-light index used for per-slot light boxes. */
export const LIGHT_BOX_BASE = 4;
/** Soft edge (metres) inside a light's bounds over which it fades out. */
export const LIGHT_BOX_EDGE = 0.3;
export function patchShaderChunks(): void {
  if (patched) return;
  patched = true;
  const chunk = THREE.ShaderChunk as Record<string, string>;

  const re = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  let begin = chunk.lights_fragment_begin;
  if (begin.includes(re)) {
    begin = begin.split(re).join('if ( directLight.visible ) ' + re);
  } else {
    console.warn('[render] shader patch: RE_Direct pattern not found (light culling branch disabled)');
  }

  const hemiLoop = /#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_HEMI_LIGHTS; i \+\+ \) \{\s+irradiance \+= getHemisphereLightIrradiance\( hemisphereLights\[ i \], geometryNormal \);\s+\}\s+#pragma unroll_loop_end/;
  let hemiOk = false;
  if (hemiLoop.test(begin)) {
    begin = begin.replace(hemiLoop, 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ 0 ], geometryNormal );');
    hemiOk = true;
  } else {
    console.warn('[render] shader patch: hemisphere loop not found (probe room boxes disabled)');
  }
  if (hemiOk) {
    const box = (index: string) => /* glsl */ `
		#if NUM_HEMI_LIGHTS >= ( ${LIGHT_BOX_BASE} + NUM_SPOT_LIGHTS + NUM_POINT_LIGHTS )
		if ( directLight.visible ) {
			vec3 cbLb = max( abs( cbWorldPos - hemisphereLights[ ${index} ].skyColor ) - hemisphereLights[ ${index} ].groundColor, 0.0 );
			float cbLk = 1.0 - smoothstep( 0.0, ${LIGHT_BOX_EDGE.toFixed(3)}, length( cbLb ) );
			directLight.color *= cbLk;
			directLight.visible = cbLk > 0.0;
		}
		#endif`;
    const pointInfo = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
    const spotInfo = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
    if (begin.includes(pointInfo) && begin.includes(spotInfo)) {
      begin = begin.replace(pointInfo, pointInfo + box(`${LIGHT_BOX_BASE} + NUM_SPOT_LIGHTS + UNROLLED_LOOP_INDEX`));
      begin = begin.replace(spotInfo, spotInfo + box(`${LIGHT_BOX_BASE} + UNROLLED_LOOP_INDEX`));
      begin = /* glsl */ `
#if NUM_HEMI_LIGHTS >= ${LIGHT_BOX_BASE}
	vec3 cbWorldPos = cameraPosition + ( - vViewPosition ) * mat3( viewMatrix );
#endif
` + begin;
      lightBoxesAvailable = true;
    } else {
      console.warn('[render] shader patch: light info calls not found (LightDesc.bounds disabled)');
    }
  }
  chunk.lights_fragment_begin = begin;
  probeBoxesAvailable = hemiOk;

  if (hemiOk) {
    chunk.lights_fragment_maps += /* glsl */ `
#if defined( USE_ENVMAP ) && ( NUM_HEMI_LIGHTS >= 4 ) && ( defined( RE_IndirectSpecular ) || defined( RE_IndirectDiffuse ) )
{
	vec3 cbWorld = cameraPosition + ( - vViewPosition ) * mat3( viewMatrix );
	float cbFade = max( hemisphereLights[ 3 ].skyColor.y, 0.01 );
	vec3 cbA = max( abs( cbWorld - hemisphereLights[ 1 ].skyColor ) - hemisphereLights[ 1 ].groundColor, 0.0 );
	vec3 cbB = max( abs( cbWorld - hemisphereLights[ 2 ].skyColor ) - hemisphereLights[ 2 ].groundColor, 0.0 );
	float cbWa = 1.0 - smoothstep( 0.0, cbFade, length( cbA ) );
	float cbWb = 1.0 - smoothstep( 0.0, cbFade, length( cbB ) );
	float cbW = mix( cbWa, cbWb, clamp( hemisphereLights[ 3 ].skyColor.x, 0.0, 1.0 ) );
	#if defined( RE_IndirectSpecular )
		radiance *= cbW;
	#endif
	#if defined( RE_IndirectDiffuse )
		iblIrradiance *= cbW;
	#endif
	#if defined( USE_CLEARCOAT ) && defined( RE_IndirectSpecular )
		clearcoatRadiance *= cbW;
	#endif
}
#endif
`;
  }
}

/** False when the hemisphere patch could not be applied (then only one hemisphere light may exist). */
export let probeBoxesAvailable = false;
/** True when per-slot light boxes (LightDesc.bounds) are compiled into the lighting chunk. */
export let lightBoxesAvailable = false;
