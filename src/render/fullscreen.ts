import * as THREE from 'three';

/** Shared fullscreen-triangle drawer for post passes. */
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mesh = new THREE.Mesh(geometry);
mesh.frustumCulled = false;
mesh.matrixAutoUpdate = false;

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export function drawFullscreen(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
  mesh.material = material;
  renderer.setRenderTarget(target);
  renderer.render(mesh, camera);
}

export function passMaterial(
  name: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  defines: Record<string, string | number> = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    vertexShader: FS_VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
    fog: false,
  });
}

/** Kick off (non-blocking) compilation of a pass material for the given output target. */
export function compilePass(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
  mesh.material = material;
  renderer.setRenderTarget(target);
  renderer.compile(mesh, camera);
}
