import * as THREE from 'three';
import type { PostFx } from '../core/types';
import { compilePass, drawFullscreen, passMaterial } from './fullscreen';
import type { QualityPreset } from './quality';
import { ADAPT_FRAG, AO_BLUR_FRAG, AO_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, COMPOSITE_FRAG, FINAL_FRAG, MERGE_FRAG, METER_FRAG } from './shaders';

/** Look-dev knobs (exposed as `render.settings` for tuning from the console / harness). */
export interface LookSettings {
  exposure: number;
  /** Exposure adaptation: scene average luminance above `adaptKey` stops the exposure down, to at most `adaptMin`. 1 disables. */
  adaptKey: number;
  adaptMin: number;
  bloom: number;
  bloomThreshold: number;
  bloomKnee: number;
  bloomRadius: number;
  dirt: number;
  aberration: number;
  vignette: number;
  grain: number;
  saturation: number;
  aoRadius: number;
  aoIntensity: number;
  aoStrength: number;
  mistDensity: number;
  mistFalloff: number;
  mistBase: number;
  /** Stage 3d: the mist base follows the camera's feet downward (min(mistBase, feet)), for levels far below y 0
   *  (level 6's chamber at −20). Off by default: levels 1–5 keep the fixed base. A level turns it on. */
  mistFollow: boolean;
  /** Stage 3d (IB6): with `mistFollow`, the floor below the camera as the level knows it (the lowest floor of the room
   *  the camera is in — set each frame by the level; NaN = unknown): the base is min(mistBase, feet, mistFloor), so from
   *  a gallery 8 m above a dock the mist sits on the dock, not at the gallery's feet. Levels that never set it keep the
   *  feet rule. */
  mistFloor: number;
  mistColor: THREE.Color;
}

export function defaultLook(): LookSettings {
  return {
    exposure: 1.0,
    adaptKey: 0.12,
    adaptMin: 0.45,
    bloom: 0.55,
    bloomThreshold: 0.85,
    bloomKnee: 0.6,
    bloomRadius: 1.0,
    dirt: 0.9,
    aberration: 0.008,
    vignette: 0.42,
    grain: 0.05,
    saturation: 0.94,
    aoRadius: 0.75,
    aoIntensity: 1.25,
    aoStrength: 0.95,
    mistDensity: 0.02,
    mistFalloff: 1.3,
    mistBase: 0.0,
    mistFollow: true,
    mistFloor: NaN,
    mistColor: new THREE.Color(0.006, 0.0095, 0.012),
  };
}

function makeDirtTexture(): THREE.Texture {
  const w = 512, h = 288;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  let seed = 9001;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  g.globalCompositeOperation = 'lighter';
  // Soft dust specks / bokeh discs, denser towards the edges.
  for (let i = 0; i < 260; i++) {
    let x = rnd(), y = rnd();
    if (rnd() < 0.55) { const a = rnd() * Math.PI * 2, r = 0.32 + rnd() * 0.3; x = 0.5 + Math.cos(a) * r; y = 0.5 + Math.sin(a) * r * 1.1; }
    const r = (rnd() < 0.85 ? 2 + rnd() * 9 : 12 + rnd() * 26);
    const a = 0.03 + rnd() * 0.11;
    const grad = g.createRadialGradient(x * w, y * h, r * 0.55, x * w, y * h, r);
    const tint = rnd() < 0.5 ? '200,225,255' : '255,235,205';
    grad.addColorStop(0, `rgba(${tint},${a})`);
    grad.addColorStop(0.8, `rgba(${tint},${a * 1.25})`);
    grad.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = grad;
    g.beginPath(); g.arc(x * w, y * h, r, 0, Math.PI * 2); g.fill();
  }
  // Smears / wipe streaks.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w, y = rnd() * h, len = 40 + rnd() * 160, ang = -0.5 + rnd() * 0.5;
    const grad = g.createLinearGradient(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    grad.addColorStop(0, 'rgba(210,225,240,0)');
    grad.addColorStop(0.5, `rgba(210,225,240,${0.02 + rnd() * 0.04})`);
    grad.addColorStop(1, 'rgba(210,225,240,0)');
    g.strokeStyle = grad;
    g.lineWidth = 3 + rnd() * 14;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function hdrTarget(w: number, h: number, opts: Partial<THREE.RenderTargetOptions> = {}): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    ...opts,
  });
}

export class PostChain implements PostFx {
  readonly look = defaultLook();
  /** Scene colour (MSAA) + depth texture. */
  scene!: THREE.WebGLRenderTarget;
  /** First-person viewmodel layer, premultiplied alpha. */
  viewmodel!: THREE.WebGLRenderTarget;
  vol!: THREE.WebGLRenderTarget;
  width = 1;
  height = 1;

  private depth!: THREE.DepthTexture;
  private ao!: THREE.WebGLRenderTarget;
  private aoB!: THREE.WebGLRenderTarget;
  private hdr!: THREE.WebGLRenderTarget;
  private ldr!: THREE.WebGLRenderTarget;
  private bloom: THREE.WebGLRenderTarget[] = [];
  private preset: QualityPreset;
  private readonly white: THREE.DataTexture;

  private readonly aoMat: THREE.ShaderMaterial;
  private readonly aoBlurMat: THREE.ShaderMaterial;
  private readonly mergeMat: THREE.ShaderMaterial;
  private readonly downFirstMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly finalMat: THREE.ShaderMaterial;
  private readonly meterMat: THREE.ShaderMaterial;
  private readonly adaptMat: THREE.ShaderMaterial;
  private readonly meter: THREE.WebGLRenderTarget;
  private adaptA: THREE.WebGLRenderTarget;
  private adaptB: THREE.WebGLRenderTarget;
  private adaptDt = 0;

  // PostFx state
  private damageV = 0;
  private glitchV = 0;
  private glitchHold = 0;
  private fadeV = 0;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeT = 1;
  private fadeDur = 0;
  private lowHealth = 0;
  private lowHealthTarget = 0;
  private exposureMult = 1;
  // §8.7 grade (warmth: 0 = today's look)
  private gradeV = 0;
  private gradeFrom = 0;
  private gradeTo = 0;
  private gradeT = 1;
  private gradeDur = 0;
  private time = 0;
  private grainTime = 0;

  private readonly _fwd = new THREE.Vector3();
  private _mistFeet = NaN;
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _black = new THREE.Color(0, 0, 0);

  constructor(private readonly renderer: THREE.WebGLRenderer, preset: QualityPreset) {
    this.preset = preset;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;

    const depthU = { tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 200 } };
    this.aoMat = passMaterial('AO', AO_FRAG, {
      ...depthU,
      uDepthTexel: { value: new THREE.Vector2() },
      uInvProj: { value: new THREE.Vector2() },
      uProjScale: { value: 1 },
      uAspect: { value: 1 },
      uRadius: { value: 0.7 },
      uIntensity: { value: 1 },
    }, { AO_SAMPLES: Math.max(preset.aoSamples, 4) });
    this.aoBlurMat = passMaterial('AOBlur', AO_BLUR_FRAG, { tAO: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mergeMat = passMaterial('Merge', MERGE_FRAG, {
      tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 200 },
      tScene: { value: null },
      tViewmodel: { value: null },
      tAO: { value: null },
      uAoTexel: { value: new THREE.Vector2() },
      uAoStrength: { value: 1 },
      tVol: { value: null },
      uVolTexel: { value: new THREE.Vector2() },
      uCamPos: { value: new THREE.Vector3() },
      uCamRight: { value: new THREE.Vector3() },
      uCamUp: { value: new THREE.Vector3() },
      uCamForward: { value: new THREE.Vector3() },
      uMistColor: { value: this.look.mistColor },
      uMistDensity: { value: 0 },
      uMistFalloff: { value: 1 },
      uMistBase: { value: 0 },
    });
    const bloomU = () => ({
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uClamp: { value: 60 },
    });
    this.downFirstMat = passMaterial('BloomPrefilter', BLOOM_DOWN_FRAG, bloomU(), { FIRST: 1 });
    this.downMat = passMaterial('BloomDown', BLOOM_DOWN_FRAG, bloomU());
    this.upMat = passMaterial('BloomUp', BLOOM_UP_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uWeight: { value: 1 },
    });
    this.upMat.blending = THREE.CustomBlending;
    this.upMat.blendEquation = THREE.AddEquation;
    this.upMat.blendSrc = THREE.OneFactor;
    this.upMat.blendDst = THREE.OneFactor;
    this.upMat.transparent = true;
    this.compositeMat = passMaterial('Composite', COMPOSITE_FRAG, {
      tHdr: { value: null }, tBloom: { value: null }, tDirt: { value: makeDirtTexture() },
      uExposure: { value: 1 }, tAdapt: { value: null }, uBloom: { value: 0.1 }, uDirt: { value: 0.5 }, uAberration: { value: 0.01 },
      uVignette: { value: 0.4 }, uAspect: { value: 1 }, uDamage: { value: 0 }, uLowHealth: { value: 0 },
      uPulse: { value: 0 }, uSaturation: { value: 1 }, uGrade: { value: new THREE.Vector3() },
    });
    this.finalMat = passMaterial('Final', FINAL_FRAG, {
      tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uGlitch: { value: 0 }, uGlitchSeed: { value: 0 }, uFade: { value: 0 }, uGrain: { value: 0.04 },
    });
    const MW = 32, MH = 18;
    this.meter = hdrTarget(MW, MH, { format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const one = () => hdrTarget(1, 1, { format: THREE.RGFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.adaptA = one();
    this.adaptB = one();
    for (const t of [this.adaptA, this.adaptB]) {
      renderer.setRenderTarget(t);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(null);
    this.meterMat = passMaterial('Meter', METER_FRAG, { tHdr: { value: null }, uTexel: { value: new THREE.Vector2(1 / MW, 1 / MH) } });
    this.adaptMat = passMaterial('Adapt', ADAPT_FRAG, {
      tMeter: { value: this.meter.texture }, tPrev: { value: null }, uKey: { value: 0.2 }, uMin: { value: 0.5 }, uDt: { value: 0 },
    }, { METER_W: MW, METER_H: MH });
    this.applyDefines();
    this.allocate(4, 4);
  }

  get depthTexture(): THREE.DepthTexture { return this.depth; }
  get materials(): THREE.ShaderMaterial[] {
    return [this.aoMat, this.aoBlurMat, this.mergeMat, this.downFirstMat, this.downMat, this.upMat, this.compositeMat, this.finalMat, this.meterMat, this.adaptMat];
  }

  /** Start compiling every pass program (non-blocking; they finish in parallel with the scene's programs). */
  precompile(): void {
    for (const m of this.materials) compilePass(this.renderer, m, m === this.finalMat ? null : this.hdr);
    this.renderer.setRenderTarget(null);
  }

  private applyDefines(): void {
    const p = this.preset;
    const set = (m: THREE.ShaderMaterial, key: string, on: boolean, value: number = 1) => {
      const has = key in m.defines;
      if (on && (!has || m.defines[key] !== value)) { m.defines[key] = value; m.needsUpdate = true; }
      else if (!on && has) { delete m.defines[key]; m.needsUpdate = true; }
    };
    set(this.aoMat, 'AO_SAMPLES', true, Math.max(p.aoSamples, 4));
    set(this.mergeMat, 'USE_AO', p.ao);
    set(this.mergeMat, 'USE_VOL', p.volumetrics);
    set(this.finalMat, 'USE_FXAA', p.fxaa);
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.applyDefines();
    this.allocate(this.width, this.height);
  }

  setSize(width: number, height: number): void {
    width = Math.max(4, Math.floor(width));
    height = Math.max(4, Math.floor(height));
    if (width === this.width && height === this.height && this.scene) return;
    this.allocate(width, height);
  }

  private allocate(w: number, h: number): void {
    this.dispose();
    this.width = w;
    this.height = h;
    const p = this.preset;
    this.depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.depth.minFilter = THREE.NearestFilter;
    this.depth.magFilter = THREE.NearestFilter;
    this.scene = hdrTarget(w, h, { depthBuffer: true, depthTexture: this.depth, samples: p.msaa });
    this.viewmodel = hdrTarget(w, h, { depthBuffer: true, samples: p.vmMsaa });
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    this.ao = new THREE.WebGLRenderTarget(hw, hh, {
      type: THREE.HalfFloatType, format: THREE.RGFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.aoB = this.ao.clone();
    const vw = Math.max(2, Math.round(w * p.volScale)), vh = Math.max(2, Math.round(h * p.volScale));
    this.vol = hdrTarget(vw, vh);
    this.hdr = hdrTarget(w, h);
    this.ldr = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.bloom = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < p.bloomMips; i++) {
      this.bloom.push(hdrTarget(bw, bh));
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      if (bw <= 2 || bh <= 2) break;
    }
  }

  private dispose(): void {
    if (!this.scene) return;
    this.depth.dispose();
    for (const t of [this.scene, this.viewmodel, this.ao, this.aoB, this.vol, this.hdr, this.ldr, ...this.bloom]) t.dispose();
    this.bloom = [];
  }

  // ───────────────────────────────────────────── PostFx

  damage(amount: number): void {
    this.damageV = Math.min(1.2, Math.max(this.damageV, amount) + amount * 0.25);
  }
  glitch(amount: number, hold?: number): void {
    this.glitchV = Math.max(this.glitchV, amount);
    this.glitchHold = Math.max(this.glitchHold, hold ?? 0);
  }
  fade(to: number, seconds: number): void {
    to = Math.min(1, Math.max(0, to));
    if (seconds <= 0) { this.fadeV = this.fadeFrom = this.fadeTo = to; this.fadeT = 1; return; }
    this.fadeFrom = this.fadeV;
    this.fadeTo = to;
    this.fadeT = 0;
    this.fadeDur = seconds;
  }
  setLowHealth(amount: number): void { this.lowHealthTarget = Math.min(1, Math.max(0, amount)); }
  setExposure(mult: number): void { this.exposureMult = Math.max(0, mult); }
  /**
   * §8.7 (stage 3a): colour grade, tweened over `seconds` (wall clock, smoothstep). `warmth` > 0 counters the built-in
   * teal shadows and warms the white balance (+0.35 ≈ neutral shadows, a touch warm); < 0 colder (−0.6 = the
   * takeover: deeper teal, blue white balance, −15 % saturation). 0 = the built-in look exactly. No recompile.
   */
  grade(warmth: number, seconds: number): void {
    warmth = Math.min(1, Math.max(-1, warmth));
    if (seconds <= 0) { this.gradeV = this.gradeFrom = this.gradeTo = warmth; this.gradeT = 1; return; }
    this.gradeFrom = this.gradeV;
    this.gradeTo = warmth;
    this.gradeT = 0;
    this.gradeDur = seconds;
  }
  /** Current grade warmth (debug). */
  get warmth(): number { return this.gradeV; }

  /** @param realDt wall-clock seconds (post effects keep animating while the simulation is paused) */
  update(realDt: number, simDt: number): void {
    this.time += realDt;
    this.adaptDt = realDt;
    if (simDt > 0) this.grainTime += realDt;
    this.damageV = Math.max(0, this.damageV - realDt * (0.55 + this.damageV * 1.4));
    if (this.glitchHold > 0) this.glitchHold -= realDt;
    else this.glitchV = Math.max(0, this.glitchV - realDt * (0.4 + this.glitchV * 3.0));
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + realDt / this.fadeDur);
      const k = this.fadeT * this.fadeT * (3 - 2 * this.fadeT);
      this.fadeV = this.fadeFrom + (this.fadeTo - this.fadeFrom) * k;
    }
    if (this.gradeT < 1) {
      this.gradeT = Math.min(1, this.gradeT + realDt / this.gradeDur);
      const k = this.gradeT * this.gradeT * (3 - 2 * this.gradeT);
      this.gradeV = this.gradeFrom + (this.gradeTo - this.gradeFrom) * k;
    }
    this.lowHealth += (this.lowHealthTarget - this.lowHealth) * Math.min(1, realDt * 4);
    if (Math.abs(this.lowHealth - this.lowHealthTarget) < 0.002) this.lowHealth = this.lowHealthTarget;
  }

  /** Debug: [adapted exposure multiplier, metered average luminance] (synchronous GPU read-back — never call per frame). */
  readAdaptation(): [number, number] {
    const buf = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.adaptA, 0, 0, 1, 1, buf);
    return [THREE.DataUtils.fromHalfFloat(buf[0]), THREE.DataUtils.fromHalfFloat(buf[1])];
  }

  // ───────────────────────────────────────────── chain

  /** Runs everything after the scene + viewmodel passes and presents to the canvas. */
  render(camera: THREE.PerspectiveCamera, volScene: THREE.Scene | null): void {
    const r = this.renderer;
    const p = this.preset;
    const look = this.look;
    const w = this.width, h = this.height;
    const proj = camera.projectionMatrix.elements;

    // ── ambient occlusion
    if (p.ao) {
      const u = this.aoMat.uniforms;
      u.tDepth.value = this.depth;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uDepthTexel.value.set(1 / w, 1 / h);
      u.uInvProj.value.set(1 / proj[0], 1 / proj[5]);
      u.uProjScale.value = proj[5] * 0.5;
      u.uAspect.value = w / h;
      u.uRadius.value = look.aoRadius;
      u.uIntensity.value = look.aoIntensity;
      drawFullscreen(r, this.aoMat, this.ao);
      const b = this.aoBlurMat.uniforms;
      b.tAO.value = this.ao.texture;
      b.uDir.value.set(1 / this.ao.width, 0);
      drawFullscreen(r, this.aoBlurMat, this.aoB);
      b.tAO.value = this.aoB.texture;
      b.uDir.value.set(0, 1 / this.ao.height);
      drawFullscreen(r, this.aoBlurMat, this.ao);
    }

    // ── volumetric shafts
    if (p.volumetrics) {
      r.setRenderTarget(this.vol);
      r.setClearColor(this._black, 1);
      r.clear(true, false, false);
      if (volScene) r.render(volScene, camera);
    }

    // ── merge
    {
      const u = this.mergeMat.uniforms;
      u.tDepth.value = this.depth;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.tScene.value = this.scene.texture;
      u.tViewmodel.value = this.viewmodel.texture;
      u.tAO.value = this.ao.texture;
      u.uAoTexel.value.set(1 / this.ao.width, 1 / this.ao.height);
      u.uAoStrength.value = look.aoStrength;
      u.tVol.value = this.vol.texture;
      u.uVolTexel.value.set(1 / this.vol.width, 1 / this.vol.height);
      const e = camera.matrixWorld.elements;
      const tanY = 1 / proj[5], tanX = 1 / proj[0];
      this._right.set(e[0], e[1], e[2]).normalize().multiplyScalar(tanX);
      this._up.set(e[4], e[5], e[6]).normalize().multiplyScalar(tanY);
      this._fwd.set(-e[8], -e[9], -e[10]).normalize();
      u.uCamPos.value.set(e[12], e[13], e[14]);
      u.uCamRight.value.copy(this._right);
      u.uCamUp.value.copy(this._up);
      u.uCamForward.value.copy(this._fwd);
      u.uMistDensity.value = look.mistDensity;
      u.uMistFalloff.value = look.mistFalloff;
      if (look.mistFollow) {
        const floor = look.mistFloor;
        const feet = Math.min(look.mistBase, e[13] - 1.6, Number.isFinite(floor) ? floor : Infinity);
        this._mistFeet = Number.isFinite(this._mistFeet) ? this._mistFeet + (feet - this._mistFeet) * 0.1 : feet;
        u.uMistBase.value = this._mistFeet;
      } else u.uMistBase.value = look.mistBase;
      drawFullscreen(r, this.mergeMat, this.hdr);
    }

    // ── bloom: prefilter + progressive downsample, then additive tent upsample back up the chain
    {
      const n = this.bloom.length;
      let src: THREE.WebGLRenderTarget = this.hdr;
      for (let i = 0; i < n; i++) {
        const m = i === 0 ? this.downFirstMat : this.downMat;
        const u = m.uniforms;
        u.tSrc.value = src.texture;
        u.uTexel.value.set(1 / src.width, 1 / src.height);
        u.uThreshold.value = look.bloomThreshold;
        u.uKnee.value = look.bloomKnee;
        drawFullscreen(r, m, this.bloom[i]);
        src = this.bloom[i];
      }
      const u = this.upMat.uniforms;
      for (let i = n - 2; i >= 0; i--) {
        const s = this.bloom[i + 1];
        u.tSrc.value = s.texture;
        u.uTexel.value.set(1 / s.width, 1 / s.height);
        u.uRadius.value = look.bloomRadius;
        u.uWeight.value = 1;
        drawFullscreen(r, this.upMat, this.bloom[i]);
      }
    }

    // ── exposure adaptation (meter → 1×1 ping-pong)
    {
      this.meterMat.uniforms.tHdr.value = this.hdr.texture;
      drawFullscreen(r, this.meterMat, this.meter);
      const u = this.adaptMat.uniforms;
      u.tPrev.value = this.adaptA.texture;
      u.uKey.value = look.adaptKey;
      u.uMin.value = look.adaptMin;
      u.uDt.value = this.adaptDt;
      drawFullscreen(r, this.adaptMat, this.adaptB);
      const t = this.adaptA; this.adaptA = this.adaptB; this.adaptB = t;
      this.adaptDt = 0;
    }

    // ── composite to display space
    {
      const u = this.compositeMat.uniforms;
      const n = this.bloom.length;
      u.tHdr.value = this.hdr.texture;
      u.tAdapt.value = this.adaptA.texture;
      u.tBloom.value = this.bloom[0].texture;
      u.uExposure.value = look.exposure * this.exposureMult;
      u.uBloom.value = look.bloom / n;
      u.uDirt.value = (look.dirt * look.bloom) / n;
      u.uAberration.value = look.aberration + this.glitchV * 0.05 + this.damageV * 0.02;
      u.uVignette.value = look.vignette;
      u.uAspect.value = w / h;
      u.uDamage.value = this.damageV;
      u.uLowHealth.value = this.lowHealth;
      // Heartbeat: two quick thumps per ~1.1 s cycle.
      const ph = (this.time * 0.92) % 1;
      const beat = Math.exp(-ph * 9) + 0.7 * Math.exp(-Math.abs(ph - 0.22) * 14);
      u.uPulse.value = Math.min(1, beat);
      u.uSaturation.value = look.saturation;
      // warmth → (teal removal, white balance, saturation): w > 0 removes the teal by 2.2 w (0.35 → 77 %), w < 0 deepens it
      const g = this.gradeV;
      if (g === 0) u.uGrade.value.set(0, 0, 0);
      else u.uGrade.value.set(g > 0 ? Math.min(1, g * 2.2) : g * 0.9, g, g < 0 ? g * 0.25 : g * 0.05);
      drawFullscreen(r, this.compositeMat, this.ldr);
    }

    // ── final: glitch, FXAA, grain, fade
    {
      const u = this.finalMat.uniforms;
      u.tColor.value = this.ldr.texture;
      u.uTexel.value.set(1 / w, 1 / h);
      u.uTime.value = this.grainTime % 1000;
      u.uGlitch.value = this.glitchV;
      u.uGlitchSeed.value = Math.floor(this.time * 22) % 977;
      u.uFade.value = this.fadeV;
      u.uGrain.value = look.grain;
      drawFullscreen(r, this.finalMat, null);
    }
  }
}
