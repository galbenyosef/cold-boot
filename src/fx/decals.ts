/**
 * Persistent surface decals. One InstancedMesh per (decal name, variant) material, each a ring buffer.
 * All batches + materials are created at load so placing a decal never compiles or allocates.
 *
 * REVISION 5.2: a decal may be anchored to a moving Object3D (door leaf, mover). Its matrix is then kept in
 * the anchor's local space and re-derived only on frames where the anchor's world matrix or visibility
 * changed; it is hidden (zero matrix) while the anchor or a parent is hidden and released for good once the
 * anchor has left the scene. Static decals are untouched (same batches, same ring budget).
 */
import * as THREE from 'three';
import type { DecalName, MaterialLibrary } from '../core/types';

const VARIANTS: Partial<Record<DecalName, number>> = {
  bullet_metal: 3, bullet_concrete: 3, blood_splat: 3, oil_stain: 2, oil_drip: 2, scorch: 2,
};
const CAPACITY: Partial<Record<DecalName, number>> = {
  bullet_metal: 96, bullet_concrete: 96, blood_splat: 48, oil_stain: 48, oil_drip: 32, scorch: 16,
};
export const DECAL_NAMES: DecalName[] = [
  'blood_splat', 'blood_smear', 'blood_pool', 'oil_stain', 'oil_drip', 'scorch',
  'bullet_metal', 'bullet_concrete', 'scratches', 'grime', 'handprint', 'water_stain',
];

interface Batch {
  mesh: THREE.InstancedMesh | null;
  /** Fallback when a material cannot be instanced (custom ShaderMaterial without instancing chunk). */
  singles: THREE.Mesh[] | null;
  next: number;
  used: number;
  cap: number;
  /** Anchor per slot (null = static world decal). */
  anchor: (Anchor | null)[];
  /** Decal matrix in its anchor's local space, 16 floats per slot (anchored slots only). */
  local: Float32Array;
  /** Placement serial per slot (checks / debug: which decal is new). */
  serial: Uint32Array;
  dirty: boolean;
}

interface Anchor {
  obj: THREE.Object3D;
  slots: { b: Batch; i: number }[];
  /** Anchor world matrix the slots were last written with. */
  last: Float32Array;
  shown: boolean;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const sc = new THREE.Vector3();
const pos = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1);
const nrm = new THREE.Vector3();
const qRoll = new THREE.Quaternion();
const xAx = new THREE.Vector3();
const yAx = new THREE.Vector3();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
const inv = new THREE.Matrix4();
const lm = new THREE.Matrix4();

/** Attached to a scene and visible all the way up (null = detached / gone). */
function chainState(o: THREE.Object3D): 'shown' | 'hidden' | null {
  let vis = true;
  let p: THREE.Object3D | null = o;
  let top: THREE.Object3D = o;
  while (p) { if (!p.visible) vis = false; top = p; p = p.parent; }
  if (!(top as THREE.Scene).isScene) return null;
  return vis ? 'shown' : 'hidden';
}

/** Private decal (not a library `DecalName`): the glass star, placed through `place(GLASS_STAR, …)`. */
export const GLASS_STAR = '__glass_star' as DecalName;
function glassStarMaterial(): THREE.Material {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cx = S / 2, cy = S / 2;
  // crushed core: a frosted disc with a dark hole
  const cg = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.09);
  cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(0.6, 'rgba(235,242,246,0.7)'); cg.addColorStop(1, 'rgba(235,242,246,0)');
  g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, S * 0.09, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(20,24,26,0.8)'; g.beginPath(); g.arc(cx, cy, S * 0.012, 0, Math.PI * 2); g.fill();
  // radial cracks with branches, and a few concentric arcs
  g.strokeStyle = 'rgba(245,250,252,0.9)'; g.lineCap = 'round';
  const n = 11 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + r() * 0.4, x = cx, y = cy;
    const len = S * (0.22 + r() * 0.26);
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      a += (r() - 0.5) * 0.35;
      x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6;
      g.lineTo(x, y);
      if (r() < 0.3) { const b = a + (r() < 0.5 ? 0.6 : -0.6); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * len * 0.15, y + Math.sin(b) * len * 0.15); g.moveTo(x, y); }
    }
    g.stroke();
  }
  g.lineWidth = 1;
  for (const rr of [0.07, 0.13]) {
    g.beginPath();
    for (let i = 0; i < 9; i++) { const a0 = r() * Math.PI * 2; g.moveTo(cx + Math.cos(a0) * S * rr, cy + Math.sin(a0) * S * rr); g.arc(cx, cy, S * rr, a0, a0 + 0.3 + r() * 0.3); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({
    name: 'fx_glass_star', map: t, color: 0xeef4f8, transparent: true, depthWrite: false, roughness: 0.25, metalness: 0,
    emissive: 0x8a96a0, emissiveMap: t, emissiveIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  return m;
}

export class Decals {
  readonly root = new THREE.Group();
  private batches = new Map<DecalName, Batch[]>();
  private geo = new THREE.PlaneGeometry(1, 1);
  private anchors = new Map<THREE.Object3D, Anchor>();
  private serial = 0;

  constructor(materials: MaterialLibrary) {
    this.root.name = 'fx_decals';
    const seen = new Map<THREE.Material, Batch>();
    for (const name of DECAL_NAMES) {
      const list: Batch[] = [];
      const nv = VARIANTS[name] ?? 1;
      const cap = CAPACITY[name] ?? 24;
      for (let v = 0; v < nv; v++) {
        let mat: THREE.Material;
        try { mat = materials.decal(name, v); } catch { continue; }
        if (!mat) continue;
        const prev = seen.get(mat);
        if (prev) { list.push(prev); continue; }
        const b = this.makeBatch(mat, cap, `fx_decal_${name}_${v}`);
        seen.set(mat, b);
        list.push(b);
      }
      this.batches.set(name, list);
    }
    // Stage 3b (B9): a pale crazed star for hits on glass (the library's bullet pits are dark — invisible on dark panes)
    this.batches.set(GLASS_STAR, [this.makeBatch(glassStarMaterial(), 32, 'fx_decal_glass_star')]);
  }

  private makeBatch(mat: THREE.Material, cap: number, name: string): Batch {
    const shader = mat as THREE.ShaderMaterial;
    const instancable = !shader.isShaderMaterial || /instanc/i.test(shader.vertexShader ?? '');
    if (instancable) {
      const mesh = new THREE.InstancedMesh(this.geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      mesh.name = name;
      mesh.visible = false;
      this.root.add(mesh);
      return { mesh, singles: null, next: 0, used: 0, cap, anchor: new Array(cap).fill(null), local: new Float32Array(cap * 16), serial: new Uint32Array(cap), dirty: false };
    }
    const singles: THREE.Mesh[] = [];
    const n = Math.min(cap, 24);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false; m.matrixAutoUpdate = false; m.renderOrder = 1; m.receiveShadow = true;
      this.root.add(m);
      singles.push(m);
    }
    return { mesh: null, singles, next: 0, used: 0, cap: n, anchor: new Array(n).fill(null), local: new Float32Array(n * 16), serial: new Uint32Array(n), dirty: false };
  }

  /** Make all batches visible once (shader warm-up), call `settle()` afterwards. */
  warm(on: boolean) {
    for (const list of this.batches.values()) for (const b of list) {
      if (b.mesh) { b.mesh.visible = on || b.used > 0; if (on) b.mesh.count = Math.max(b.used, 1); else b.mesh.count = b.used; }
    }
  }

  /** `anchor`: the moving thing the surface belongs to (see class doc); omit for static world. */
  place(name: DecalName, point: THREE.Vector3, normal: THREE.Vector3, size: number, roll = Math.random() * Math.PI * 2, offset = 0.006, anchor: THREE.Object3D | null = null) {
    const list = this.batches.get(name);
    if (!list || list.length === 0) return;
    const b = list[(Math.random() * list.length) | 0];
    nrm.copy(normal);
    if (nrm.lengthSq() < 1e-8) nrm.set(0, 1, 0); else nrm.normalize();
    if (Number.isNaN(roll)) {
      // upright: local +Y points to world up projected on the surface (drips run downward)
      yAx.set(0, 1, 0).addScaledVector(nrm, -nrm.y);
      if (yAx.lengthSq() < 1e-4) yAx.set(0, 0, -1).addScaledVector(nrm, -nrm.z);
      yAx.normalize();
      xAx.crossVectors(yAx, nrm);
      m4.makeBasis(xAx, yAx, nrm);
      q.setFromRotationMatrix(m4);
    } else {
      q.setFromUnitVectors(zAxis, nrm);
      qRoll.setFromAxisAngle(zAxis, roll);
      q.multiply(qRoll);
    }
    // tiny per-decal offset jitter avoids z-fighting between overlapping decals
    pos.copy(point).addScaledVector(nrm, offset + Math.random() * 0.002);
    sc.set(size, size, size);
    m4.compose(pos, q, sc);
    const i = b.next;
    b.next = (b.next + 1) % b.cap;
    b.used = Math.min(b.cap, b.used + 1);
    this.unanchor(b, i);
    b.serial[i] = ++this.serial;
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      lm.copy(inv.copy(anchor.matrixWorld).invert()).multiply(m4);
      lm.toArray(b.local, i * 16);
      let a = this.anchors.get(anchor);
      if (!a) { a = { obj: anchor, slots: [], last: new Float32Array(anchor.matrixWorld.elements), shown: true }; this.anchors.set(anchor, a); }
      a.slots.push({ b, i });
      b.anchor[i] = a;
      // placed on something hidden (should not happen: it was just hit) — let update() decide
      if (!a.shown) m4.copy(zero);
    }
    if (b.mesh) {
      b.mesh.setMatrixAt(i, m4);
      b.mesh.count = b.used;
      b.mesh.instanceMatrix.clearUpdateRanges();
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.visible = true;
    } else if (b.singles) {
      const m = b.singles[i];
      m.matrix.copy(m4);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
    }
  }

  private unanchor(b: Batch, i: number) {
    const a = b.anchor[i];
    if (!a) return;
    b.anchor[i] = null;
    const k = a.slots.findIndex((s) => s.b === b && s.i === i);
    if (k >= 0) a.slots.splice(k, 1);
    if (a.slots.length === 0) this.anchors.delete(a.obj);
  }

  private write(b: Batch, i: number, m: THREE.Matrix4) {
    if (b.mesh) { b.mesh.setMatrixAt(i, m); b.dirty = true; }
    else if (b.singles) { const s = b.singles[i]; s.matrix.copy(m); s.matrixWorldNeedsUpdate = true; s.visible = m !== zero; }
  }

  /** Anchored decals follow their anchors (only those whose anchor moved / changed visibility). */
  update() {
    if (this.anchors.size === 0) return;
    let touched = false;
    for (const a of this.anchors.values()) {
      const st = chainState(a.obj);
      if (st === null) {
        // the thing is gone: its decals go with it (slots stay in the ring, zeroed, until recycled)
        for (const s of a.slots) { s.b.anchor[s.i] = null; this.write(s.b, s.i, zero); }
        a.slots.length = 0;
        this.anchors.delete(a.obj);
        touched = true;
        continue;
      }
      a.obj.updateWorldMatrix(true, false);
      const e = a.obj.matrixWorld.elements, L = a.last;
      const shown = st === 'shown';
      let moved = false;
      for (let k = 0; k < 16; k++) if (L[k] !== e[k]) { moved = true; break; }
      if (!moved && shown === a.shown) continue;
      a.shown = shown;
      for (let k = 0; k < 16; k++) L[k] = e[k];
      for (const s of a.slots) {
        if (shown) { lm.fromArray(s.b.local, s.i * 16); m4.multiplyMatrices(a.obj.matrixWorld, lm); this.write(s.b, s.i, m4); }
        else this.write(s.b, s.i, zero);
      }
      touched = true;
    }
    if (!touched) return;
    for (const list of this.batches.values()) for (const b of list) {
      if (!b.dirty || !b.mesh) continue;
      b.dirty = false;
      b.mesh.instanceMatrix.clearUpdateRanges();
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Debug / checks: world matrices + anchors of the live decals. */
  debugList(): { name: string; slot: number; serial: number; anchor: THREE.Object3D | null; matrix: THREE.Matrix4; visible: boolean }[] {
    const out: { name: string; slot: number; serial: number; anchor: THREE.Object3D | null; matrix: THREE.Matrix4; visible: boolean }[] = [];
    const seen = new Set<Batch>();
    for (const [name, list] of this.batches) for (const b of list) {
      if (seen.has(b)) continue;
      seen.add(b);
      const bn = `${name}/${seen.size - 1}`;
      for (let i = 0; i < b.used; i++) {
        const m = new THREE.Matrix4();
        if (b.mesh) b.mesh.getMatrixAt(i, m); else if (b.singles) m.copy(b.singles[i].matrix);
        const sx = new THREE.Vector3().setFromMatrixColumn(m, 0).length();
        const vis = sx > 1e-6 && (b.mesh ? b.mesh.visible : !!b.singles?.[i].visible);
        out.push({ name: bn, slot: i, serial: b.serial[i], anchor: b.anchor[i]?.obj ?? null, matrix: m, visible: vis });
      }
    }
    return out;
  }

  clear() {
    this.anchors.clear();
    for (const list of this.batches.values()) for (const b of list) {
      b.anchor.fill(null);
      b.used = 0; b.next = 0;
      if (b.mesh) { b.mesh.count = 0; b.mesh.visible = false; }
      if (b.singles) for (const m of b.singles) m.visible = false;
    }
  }
}
