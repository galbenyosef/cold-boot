import * as THREE from 'three';
import type { Handle } from './lights';
import type { QualityPreset } from './quality';
import { LIGHT_BOX_EDGE } from './patch';
import { VOL_FRAG, VOL_VERT } from './shaders';

/** Global scattering strength: radiance per candela per metre of beam (tuned by eye against the grade). */
const SCATTER = 0.0016;
const MAX_ANGLE = 1.2;

function makeNoiseTexture(size = 128): THREE.DataTexture {
  // Tileable multi-octave value noise in RG (two decorrelated fields), B = finer detail.
  const data = new Uint8Array(size * size * 4);
  let seed = 1337;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const field = (period: number) => {
    const lat = new Float32Array(period * period);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    return (x: number, y: number) => {
      const fx = (x / size) * period, fy = (y / size) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = lat[(y0 % period) * period + (x0 % period)];
      const b = lat[(y0 % period) * period + ((x0 + 1) % period)];
      const c = lat[((y0 + 1) % period) * period + (x0 % period)];
      const d = lat[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  for (let ch = 0; ch < 3; ch++) {
    const o1 = field(ch === 2 ? 16 : 4), o2 = field(ch === 2 ? 32 : 8), o3 = field(ch === 2 ? 64 : 16), o4 = field(32);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = o1(x, y) * 0.5 + o2(x, y) * 0.27 + o3(x, y) * 0.15 + o4(x, y) * 0.08;
        v = Math.min(1, Math.max(0, (v - 0.22) / 0.56));
        data[(y * size + x) * 4 + ch] = Math.round(v * 255);
      }
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function makeConeGeometry(segments = 24): THREE.BufferGeometry {
  // Apex at the origin, opening along +Z, base at z = 1 with radius 1. Outward-facing triangles.
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 1);
  }
  pos.push(0, 0, 1);
  const centre = segments + 1;
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const b0 = 1 + i, b1 = 1 + ((i + 1) % segments);
    idx.push(0, b1, b0);
    idx.push(centre, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.5), 1.5);
  return g;
}

class Cone {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  constructor(readonly handle: Handle, geometry: THREE.BufferGeometry, shared: Record<string, THREE.IUniform>, defines: Record<string, number | string>) {
    this.material = new THREE.ShaderMaterial({
      name: 'VolumetricCone',
      vertexShader: VOL_VERT,
      fragmentShader: VOL_FRAG,
      defines,
      uniforms: {
        ...shared,
        uApex: { value: new THREE.Vector3() },
        uAxis: { value: new THREE.Vector3(0, -1, 0) },
        uCosOuter: { value: 0.8 },
        uCosInner: { value: 0.9 },
        uRange: { value: 10 },
        uColor: { value: new THREE.Color() },
        tShadow: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowOn: { value: 0 },
        uBoxC: { value: new THREE.Vector3() },
        uBoxH: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
      },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.visible = false;
  }
}

/**
 * Light shafts for `volumetric: true` spot lights. Each is a cone proxy whose fragment shader ray-marches
 * single scattering through the beam (spot profile, inverse-square falloff, drifting dust noise, and — for
 * lights that currently own a shadow slot — the light's shadow map, so geometry carves the shaft).
 * Rendered additively into its own (usually half-res) HDR buffer against the scene depth.
 */
export class Volumetrics {
  readonly scene = new THREE.Scene();
  enabled = true;
  /** Look-dev multiplier on shaft brightness. */
  strength = 1;
  /** Number of cones drawn last frame. */
  visibleCount = 0;
  private readonly cones: Cone[] = [];
  private readonly geometry = makeConeGeometry();
  private readonly defines: Record<string, number | string> = { VOL_STEPS: 12 };
  private readonly shared = {
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.05 },
    uFar: { value: 200 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCamForward: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uFrame: { value: 0 },
    tNoise: { value: makeNoiseTexture() as THREE.Texture },
  };
  private time = 0;
  private frame = 0;
  private warmMesh: THREE.Mesh | null = null;

  constructor(preset: QualityPreset) {
    this.scene.matrixWorldAutoUpdate = true;
    this.setQuality(preset);
  }

  setQuality(preset: QualityPreset): void {
    this.enabled = preset.volumetrics;
    const steps = preset.volSteps;
    const shadows = preset.volShadows;
    let changed = this.defines.VOL_STEPS !== steps;
    this.defines.VOL_STEPS = steps;
    if (shadows !== ('VOL_SHADOWS' in this.defines)) {
      changed = true;
      if (shadows) this.defines.VOL_SHADOWS = 1; else delete this.defines.VOL_SHADOWS;
    }
    if (changed) {
      for (const c of this.cones) c.material.needsUpdate = true;
      if (this.warmMesh) (this.warmMesh.material as THREE.Material).needsUpdate = true;
    }
  }

  add(handle: Handle): void {
    if (!handle.isSpot || !handle.desc.volumetric) return;
    const cone = new Cone(handle, this.geometry, this.shared, this.defines);
    this.cones.push(cone);
    this.scene.add(cone.mesh);
  }

  remove(handle: Handle): void {
    for (let i = 0; i < this.cones.length; i++) {
      if (this.cones[i].handle !== handle) continue;
      const c = this.cones[i];
      this.scene.remove(c.mesh);
      c.material.dispose();
      this.cones.splice(i, 1);
      return;
    }
  }

  get count(): number { return this.cones.length; }

  /** Compile the shaft program up front so the first volumetric light added during gameplay does not hitch. */
  warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.warmMesh) return;
    const mat = new THREE.ShaderMaterial({
      name: 'VolumetricCone',
      vertexShader: VOL_VERT,
      fragmentShader: VOL_FRAG,
      defines: this.defines,
      uniforms: {
        ...this.shared,
        uApex: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(0, -1, 0) }, uCosOuter: { value: 0.8 },
        uCosInner: { value: 0.9 }, uRange: { value: 10 }, uColor: { value: new THREE.Color() },
        tShadow: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
        uBoxC: { value: new THREE.Vector3() }, uBoxH: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
      },
      side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      toneMapped: false, fog: false,
    });
    // Kept alive on purpose: holding one material keeps the program in three's cache for the whole session.
    this.warmMesh = new THREE.Mesh(this.geometry, mat);
    this.warmMesh.frustumCulled = false;
    renderer.compile(this.warmMesh, camera);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, depth: THREE.Texture, width: number, height: number): boolean {
    this.time += dt;
    if (dt > 0) this.frame = (this.frame + 1) % 1024;
    const sh = this.shared;
    sh.tDepth.value = depth;
    sh.uNear.value = camera.near;
    sh.uFar.value = camera.far;
    sh.uResolution.value.set(width, height);
    camera.getWorldDirection(sh.uCamForward.value);
    sh.uTime.value = this.time;
    sh.uFrame.value = this.frame;

    let any = false;
    const camPos = camera.matrixWorld.elements;
    const cx = camPos[12], cy = camPos[13], cz = camPos[14];
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i];
      const h = c.handle;
      const mesh = c.mesh;
      const desc = h.desc;
      const range = desc.distance;
      const dx = h.position.x - cx, dy = h.position.y - cy, dz = h.position.z - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const distFade = 1 - THREE.MathUtils.smoothstep(dist, range + 28, range + 42);
      const power = desc.intensity * h._factor * distFade;
      if (!this.enabled || power <= 1e-3) { mesh.visible = false; continue; }
      mesh.visible = true;
      any = true;
      const angle = Math.min(desc.angle ?? 0.6, MAX_ANGLE);
      const penumbra = desc.penumbra ?? 0.5;
      const u = c.material.uniforms;
      (u.uApex.value as THREE.Vector3).copy(h.position);
      (u.uAxis.value as THREE.Vector3).copy(h.dir);
      u.uCosOuter.value = Math.cos(angle);
      u.uCosInner.value = Math.cos(angle * (1 - Math.max(penumbra, 0.15)));
      u.uRange.value = range;
      (u.uColor.value as THREE.Color).copy(h.color).multiplyScalar(power * SCATTER * this.strength);

      const slot = h.slot;
      let shadowOn = 0;
      if (slot && slot.shadow && !slot.dirty && desc.castShadow) {
        const shadow = (slot.light as THREE.SpotLight).shadow;
        if (shadow.map && shadow.map.depthTexture) {
          u.tShadow.value = shadow.map.depthTexture;
          (u.uShadowMatrix.value as THREE.Matrix4).copy(shadow.matrix);
          shadowOn = 1;
        }
      }
      u.uShadowOn.value = shadowOn;
      const bb = shadowOn ? undefined : desc.bounds;
      if (bb) {
        (u.uBoxC.value as THREE.Vector3).set((bb.min.x + bb.max.x) * 0.5, (bb.min.y + bb.max.y) * 0.5, (bb.min.z + bb.max.z) * 0.5);
        (u.uBoxH.value as THREE.Vector3).set(
          Math.max((bb.max.x - bb.min.x) * 0.5 - LIGHT_BOX_EDGE, 0), Math.max((bb.max.y - bb.min.y) * 0.5 - LIGHT_BOX_EDGE, 0), Math.max((bb.max.z - bb.min.z) * 0.5 - LIGHT_BOX_EDGE, 0));
      } else {
        (u.uBoxC.value as THREE.Vector3).set(0, 0, 0);
        (u.uBoxH.value as THREE.Vector3).set(1e6, 1e6, 1e6);
      }

      const r = Math.tan(angle) * range * 1.04;
      mesh.position.copy(h.position);
      mesh.scale.set(r, r, range);
      mesh.lookAt(h.aim);
    }
    this.visibleCount = any ? 1 : 0;
    return any;
  }
}
