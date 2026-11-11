import * as THREE from 'three';
import type { LightPool } from './lights';
import { ENV_BLEND_FRAG } from './shaders';

interface Probe {
  position: THREE.Vector3;
  pmrem: THREE.WebGLCubeRenderTarget | null;
  box: THREE.Box3 | null;
  dirty: boolean;
}

export interface RoomBox { bounds: THREE.Box3 }

const CROSSFADE = 0.6;
const PMREM_SIZE = 256; // PMREMGenerator's minimum cube size in r187

function pmremLikeTarget(): THREE.WebGLCubeRenderTarget {
  const t = new THREE.WebGLCubeRenderTarget(PMREM_SIZE, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
  });
  const maxLod = Math.log2(PMREM_SIZE) - 3;
  for (let lod = 0; lod <= maxLod; lod++) t.texture.mipmaps.push({ width: PMREM_SIZE >> lod, height: PMREM_SIZE >> lod } as never);
  t.texture.name = 'PMREM:blend';
  (t.texture as THREE.Texture & { isPMREMTexture?: boolean }).isPMREMTexture = true;
  return t;
}

/**
 * Reflection probes: one prefiltered (PMREM) cube per probe position, captured from the real scene.
 * `texture` is a single blend target that is bound as scene.environment forever (so materials never
 * recompile); switching rooms cross-fades the nearest probe into it mip by mip. Probes are re-captured
 * progressively (one cube face per frame) when the static lighting state changes.
 */
export class Probes {
  /** The environment texture (stable object identity). */
  readonly target = pmremLikeTarget();
  readonly probes: Probe[] = [];
  enabled = true;

  private readonly pmrem: THREE.PMREMGenerator;
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCamera: THREE.CubeCamera;
  private scratch: THREE.WebGLCubeRenderTarget | null = null;

  private readonly blendCamera: THREE.CubeCamera;
  private readonly blendMesh: THREE.Mesh;
  private readonly blendMat: THREE.ShaderMaterial;

  private rooms: readonly RoomBox[] = [];
  private current = -1;
  private fromTex: THREE.Texture | null = null;
  private toTex: THREE.Texture | null = null;
  private fromBox: THREE.Box3 | null = null;
  private toBox: THREE.Box3 | null = null;
  private toIndex = -1;
  private mix = 1;
  private swapScratch = false;
  private blendTick = 0;

  private recapFace = -1;
  private signature = NaN;
  private sigTimer = 0;
  private settle = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly lights: LightPool,
    private readonly viewmodelLayer: number,
    faceSize: number,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeRT = this.makeCubeRT(faceSize);
    this.cubeCamera = new THREE.CubeCamera(0.08, 90, this.cubeRT);
    this.cubeCamera.layers.enableAll();
    this.cubeCamera.layers.disable(viewmodelLayer);

    this.blendMat = new THREE.ShaderMaterial({
      name: 'EnvBlend',
      uniforms: { tA: { value: null }, tB: { value: null }, uMix: { value: 0 }, uLod: { value: 0 } },
      vertexShader: THREE.ShaderChunk.cube_vert,
      fragmentShader: ENV_BLEND_FRAG,
      side: THREE.BackSide,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.blendMesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), this.blendMat);
    this.blendMesh.frustumCulled = false;
    this.blendCamera = new THREE.CubeCamera(1, 10, this.target);
    this.blendPass(null, null, 0); // initialise to black so the texture is valid from the first compile
  }

  get texture(): THREE.Texture { return this.target.texture; }

  private makeCubeRT(size: number): THREE.WebGLCubeRenderTarget {
    return new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
  }

  setFaceSize(size: number): void {
    if (this.cubeRT.width === size) return;
    this.cubeRT.dispose();
    this.cubeRT = this.makeCubeRT(size);
    this.cubeCamera.renderTarget = this.cubeRT;
    this.recapFace = -1;
  }

  private blendPass(a: THREE.Texture | null, b: THREE.Texture | null, mix: number): void {
    const r = this.renderer;
    const u = this.blendMat.uniforms;
    u.tA.value = a;
    u.tB.value = b ?? a;
    u.uMix.value = b ? mix : 0;
    const t = this.target;
    const maxLod = t.texture.mipmaps.length - 1;
    const prevTarget = r.getRenderTarget();
    for (let lod = 0; lod <= maxLod; lod++) {
      u.uLod.value = lod;
      this.blendCamera.activeMipmapLevel = lod;
      const size = t.width >> lod;
      t.viewport.set(0, 0, size, size);
      this.blendCamera.update(r, this.blendMesh as unknown as THREE.Scene);
    }
    t.viewport.set(0, 0, t.width, t.height);
    r.setRenderTarget(prevTarget);
  }

  private roomOf(p: THREE.Vector3): THREE.Box3 | null {
    for (let i = 0; i < this.rooms.length; i++) if (this.rooms[i].bounds.containsPoint(p)) return this.rooms[i].bounds;
    return null;
  }

  /**
   * Capture every probe (load time). Two passes: the second one sees the first pass' result as its
   * environment, which adds one bounce of inter-reflection.
   */
  bake(positions: THREE.Vector3[], rooms: readonly RoomBox[], budgetMs = 2500): void {
    const t0 = performance.now();
    for (const p of this.probes) p.pmrem?.dispose();
    this.probes.length = 0;
    this.rooms = rooms;
    this.current = -1;
    this.mix = 1;
    this.recapFace = -1;
    for (const pos of positions) this.probes.push({ position: pos.clone(), pmrem: null, box: this.roomOf(pos), dirty: false });
    if (this.probes.length === 0) return;

    this.blendPass(null, null, 0);
    this.lights.setProbeBoxes(null, null, 0);
    for (let i = 0; i < this.probes.length; i++) this.captureFull(i);
    const firstPass = performance.now() - t0;
    if (firstPass * 2.2 < budgetMs) {
      for (let i = 0; i < this.probes.length; i++) {
        const p = this.probes[i];
        this.blendPass(p.pmrem!.texture, null, 0);
        this.lights.setProbeBoxes(p.box, p.box, 0);
        this.captureFull(i);
      }
    }
    this.signature = this.lights.staticSignature();
    this.sigTimer = 0;
  }

  private captureFull(i: number): void {
    const p = this.probes[i];
    this.lights.update(0, 0, p.position, null, true);
    this.cubeCamera.position.copy(p.position);
    this.cubeCamera.update(this.renderer, this.scene);
    p.pmrem = this.pmrem.fromCubemap(this.cubeRT.texture, p.pmrem);
    p.dirty = false;
  }

  private pick(camPos: THREE.Vector3): number {
    const ps = this.probes;
    if (ps.length === 0) return -1;
    const room = this.rooms.length ? this.roomOf(camPos) : null;
    let best = -1, bestD = Infinity;
    if (room) {
      for (let i = 0; i < ps.length; i++) {
        if (ps[i].box !== room) continue;
        const d = ps[i].position.distanceToSquared(camPos) * (i === this.current ? 0.7 : 1);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) return best;
    }
    // Between rooms (door frames) keep what we have; with no room info fall back to nearest-with-hysteresis.
    if (this.rooms.length && this.current >= 0) return this.current;
    for (let i = 0; i < ps.length; i++) {
      const d = ps[i].position.distanceToSquared(camPos) * (i === this.current ? 0.7 : 1);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Immediately show the probe for this position (after load / teleport). */
  snapTo(camPos: THREE.Vector3): void {
    const i = this.pick(camPos);
    if (i < 0) return;
    const p = this.probes[i];
    this.current = i;
    this.mix = 1;
    this.toIndex = -1;
    this.swapScratch = false;
    this.recapFace = -1;
    this.blendPass(p.pmrem!.texture, null, 0);
    this.lights.setProbeBoxes(p.box, p.box, 0);
  }

  private startTransition(toTex: THREE.Texture, toBox: THREE.Box3 | null, toIndex: number, swap: boolean): void {
    const cur = this.probes[this.current];
    this.fromTex = cur.pmrem!.texture;
    this.fromBox = cur.box;
    this.toTex = toTex;
    this.toBox = toBox;
    this.toIndex = toIndex;
    this.swapScratch = swap;
    this.mix = 0;
    this.blendTick = 0;
  }

  /** Per-frame: probe switching, cross-fade, progressive re-capture. Call after the main scene pass. */
  update(realDt: number, camPos: THREE.Vector3): void {
    if (!this.enabled || this.probes.length === 0 || this.current < 0) return;

    // Detect lighting state changes (breaker thrown, emergency lighting...) → probes are stale.
    this.sigTimer -= realDt;
    if (this.sigTimer <= 0) {
      this.sigTimer = 0.25;
      const sig = this.lights.staticSignature();
      if (Math.abs(sig - this.signature) > 1e-4) {
        this.signature = sig;
        for (const p of this.probes) p.dirty = true;
        this.settle = 0.2;
        this.recapFace = -1;
      }
    }
    if (this.settle > 0) this.settle -= realDt;

    if (this.mix < 1) {
      // Cross-fade in progress (blend every other frame to halve the cost; ~36 tiny draws per blend).
      this.mix = Math.min(1, this.mix + realDt / CROSSFADE);
      this.blendTick++;
      const k = this.mix * this.mix * (3 - 2 * this.mix);
      if (this.mix >= 1 || (this.blendTick & 1) === 0) this.blendPass(this.fromTex, this.toTex, k);
      this.lights.setProbeBoxes(this.fromBox, this.toBox, k);
      if (this.mix >= 1) {
        if (this.swapScratch) {
          const p = this.probes[this.current];
          const old = p.pmrem;
          p.pmrem = this.scratch;
          this.scratch = old;
          this.swapScratch = false;
        } else {
          this.current = this.toIndex;
        }
        const p = this.probes[this.current];
        this.lights.setProbeBoxes(p.box, p.box, 0);
        this.fromTex = this.toTex = null;
      }
      return;
    }

    const want = this.pick(camPos);
    if (want !== this.current && want >= 0) {
      this.recapFace = -1;
      const p = this.probes[want];
      this.startTransition(p.pmrem!.texture, p.box, want, false);
      return;
    }

    // Progressive re-capture of the current probe.
    const cur = this.probes[this.current];
    if (this.recapFace < 0) {
      if (cur.dirty && this.settle <= 0) this.recapFace = 0;
      return;
    }
    const r = this.renderer;
    if (this.recapFace < 6) {
      const cam = this.cubeCamera;
      if (this.recapFace === 0) { cam.position.copy(cur.position); cam.updateMatrixWorld(true); }
      this.lights.applyBake(true);
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.cubeRT, this.recapFace);
      r.render(this.scene, cam.children[this.recapFace] as THREE.Camera);
      r.setRenderTarget(prev);
      this.lights.applyBake(false);
      this.recapFace++;
    } else {
      this.scratch = this.pmrem.fromCubemap(this.cubeRT.texture, this.scratch);
      cur.dirty = false;
      this.recapFace = -1;
      this.startTransition(this.scratch.texture, cur.box, this.current, true);
    }
  }
}
