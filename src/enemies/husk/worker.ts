/**
 * Props for REVISION 4 'worker' husks: the rotary floor polisher a `polish` unit pushes, and the coverall a `fold`
 * unit folds (a hanging sheet between the hands → a folded block placed on the pile). Plain meshes (not skinned),
 * library materials, a few hundred triangles.
 */
import * as THREE from 'three';
import type { GameContext, LoopHandle, MaterialName } from '../../core/types';

let geo: { disc: THREE.BufferGeometry; skirt: THREE.BufferGeometry; motor: THREE.BufferGeometry; shaft: THREE.BufferGeometry; bar: THREE.BufferGeometry; grip: THREE.BufferGeometry; cord: THREE.BufferGeometry; block: THREE.BufferGeometry } | null = null;

/** Handle T-bar centre in polisher-local space (+Z = away from the operator). */
export const POLISHER_BAR = new THREE.Vector3(0, 0.96, -0.55);
const GRIP_X = 0.2;

function libMat(ctx: GameContext, name: MaterialName, fallback: MaterialName, color?: number): THREE.MeshStandardMaterial {
  const m = ctx.materials.get(name);
  if (m.name === name || !color) return m;
  return ctx.materials.clone(fallback, { color });
}

export function coverallMaterial(ctx: GameContext): THREE.MeshStandardMaterial {
  return libMat(ctx, 'cloth_coverall', 'fabric', 0x5f6e7c);
}

export class WorkerProps {
  readonly root = new THREE.Group();
  private polisher: THREE.Group | null = null;
  private discSpin: THREE.Object3D | null = null;
  private sheetMesh: THREE.Mesh | null = null;
  private blockMesh: THREE.Mesh | null = null;
  private sheetPos: Float32Array | null = null;
  private loop: LoopHandle | null = null;
  private dropV = 0;
  dropped = false;

  constructor(private ctx: GameContext, readonly kind: 'polish' | 'fold') {
    if (!geo) {
      const skirt = new THREE.CylinderGeometry(0.235, 0.24, 0.05, 28, 1, true);
      geo = {
        disc: new THREE.CylinderGeometry(0.225, 0.225, 0.03, 28),
        skirt,
        motor: new THREE.CylinderGeometry(0.11, 0.15, 0.2, 18),
        shaft: new THREE.CylinderGeometry(0.018, 0.018, 1, 10),
        bar: new THREE.CylinderGeometry(0.016, 0.016, 2 * GRIP_X + 0.1, 10),
        grip: new THREE.CylinderGeometry(0.022, 0.022, 0.11, 10),
        cord: new THREE.TorusGeometry(0.09, 0.009, 6, 18),
        block: new THREE.BoxGeometry(0.3, 0.05, 0.27),
      };
    }
    ctx.scene.add(this.root);
    const M = ctx.materials;
    if (kind === 'polish') {
      const g = new THREE.Group();
      const body = libMat(ctx, 'painted_yellow', 'painted_yellow');
      const dark = M.get('painted_dark'), rubber = M.get('rubber'), steel = M.get('steel_raw');
      const add = (gg: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, sy = 1) => {
        const mesh = new THREE.Mesh(gg, m); mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.scale.y = sy;
        mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
      };
      const spin = new THREE.Group(); g.add(spin); this.discSpin = spin;
      const d = new THREE.Mesh(geo.disc, rubber); d.position.y = 0.017; spin.add(d);
      add(geo.skirt, body, 0, 0.055, 0);
      const top = add(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 28), body, 0, 0.09, 0);
      void top;
      add(geo.motor, dark, 0, 0.2, 0);
      // handle: from the motor's back up to the T-bar
      const a = new THREE.Vector3(0, 0.22, -0.08), b = POLISHER_BAR.clone();
      const len = a.distanceTo(b);
      const sh = add(geo.shaft, steel, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, 0, len);
      sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      const bar = add(geo.bar, steel, b.x, b.y, b.z);
      bar.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) { const gr = add(geo.grip, rubber, s * GRIP_X, b.y, b.z); gr.rotation.z = Math.PI / 2; }
      const cord = add(geo.cord, M.get('plastic_dark'), 0.05, 0.62, -0.32);
      cord.rotation.set(0.5, 0.4, 0);
      this.polisher = g;
      this.root.add(g);
    } else {
      const mat = coverallMaterial(ctx);
      const sheetMat = mat.clone(); sheetMat.side = THREE.DoubleSide;
      const sg = new THREE.PlaneGeometry(1, 1, 6, 8);
      this.sheetPos = sg.getAttribute('position').array as Float32Array;
      const sheet = new THREE.Mesh(sg, sheetMat);
      sheet.castShadow = true; sheet.frustumCulled = false;
      this.sheetMesh = sheet;
      const block = new THREE.Mesh(geo.block, mat);
      block.castShadow = true; block.receiveShadow = true;
      this.blockMesh = block;
      this.root.add(sheet, block);
      sheet.visible = false; block.visible = false;
    }
  }

  /** Polisher pose: T-bar centre at `bar` (world), facing `yaw` (rig ry), disc swung by `sweep` rad about the bar. */
  placePolisher(bar: THREE.Vector3, ry: number, sweep: number, floorY: number, dt: number, running: boolean): void {
    const g = this.polisher;
    if (!g) return;
    g.rotation.set(0, ry + sweep, 0);
    // position so that the T-bar lands on `bar` (keep the disc on the floor)
    const c = Math.cos(ry + sweep), s = Math.sin(ry + sweep);
    g.position.set(bar.x - (POLISHER_BAR.x * c + POLISHER_BAR.z * s), floorY, bar.z - (-POLISHER_BAR.x * s + POLISHER_BAR.z * c));
    if (this.discSpin) this.discSpin.rotation.y += (running ? 24 : 0) * dt;
    g.updateMatrixWorld(true);
  }

  /** World position of a handle grip (side +1 = operator's left). */
  grip(side: number, out: THREE.Vector3): THREE.Vector3 {
    const g = this.polisher!;
    return out.set(side * GRIP_X * 0.82, POLISHER_BAR.y, POLISHER_BAR.z).applyMatrix4(g.matrixWorld);
  }

  /** Hanging sheet whose top edge runs from hand L to hand R; `len` = hanging length; `swing` adds sway. */
  sheet(a: THREE.Vector3, b: THREE.Vector3, len: number, swing: number, t: number, toward: THREE.Vector3): void {
    const m = this.sheetMesh!, pos = this.sheetPos!;
    if (this.blockMesh) this.blockMesh.visible = false;
    m.visible = len > 0.02;
    if (!m.visible) return;
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    // PlaneGeometry(1,1,6,8): x in [-0.5,0.5] (cols), y in [0.5,-0.5] (rows top → bottom)
    for (let j = 0, k = 0; j <= 8; j++) {
      const v = j / 8;
      for (let i = 0; i <= 6; i++, k += 3) {
        const u = i / 6;
        const sag = Math.sin(Math.PI * u) * 0.04 * (1 - v * 0.5);
        const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
        const y = a.y + (b.y - a.y) * u - sag - v * len;
        // the lower part bellies toward `toward` (the shelf) and sways
        const bel = v * v * (0.05 + swing * Math.sin(t * 7 + u * 2.4) * 0.05);
        pos[k] = x + toward.x * bel; pos[k + 1] = y; pos[k + 2] = z + toward.z * bel;
      }
    }
    const geom = m.geometry;
    geom.getAttribute('position').needsUpdate = true;
    geom.computeVertexNormals();
  }

  /** Folded block at a world position (centre of the bottom face) facing rig yaw `ry`. */
  block(p: THREE.Vector3, ry: number): void {
    if (this.sheetMesh) this.sheetMesh.visible = false;
    const b = this.blockMesh!;
    b.visible = true;
    b.position.set(p.x, p.y + 0.025, p.z);
    b.rotation.set(0, ry, 0);
  }

  hideCloth(): void {
    if (this.sheetMesh) this.sheetMesh.visible = false;
    if (this.blockMesh) this.blockMesh.visible = false;
  }

  /** Motor loop (polisher) while near enough to hear. */
  sound(on: boolean, pos: THREE.Vector3 | null): void {
    if (on && !this.loop && pos) {
      try { this.loop = this.ctx.audio.loop('polisher_loop', { position: pos, volume: 0.7 }); } catch { this.loop = null; }
    } else if (!on && this.loop) { try { this.loop.stop(0.4); } catch { /* */ } this.loop = null; }
    else if (on && this.loop && pos) this.loop.setPosition(pos);
  }

  /** The unit lets go: polisher stays where it is, the cloth falls to the floor. */
  drop(): void {
    this.dropped = true;
    this.sound(false, null);
  }
  tickDrop(dt: number, floorY: number): void {
    if (!this.dropped) return;
    const fall = (o: THREE.Object3D | null, h: number) => {
      if (!o || !o.visible) return;
      if (o.position.y > floorY + h) { this.dropV += 9.8 * dt; o.position.y = Math.max(floorY + h, o.position.y - this.dropV * dt); }
    };
    if (this.sheetMesh?.visible) {
      // the hanging sheet collapses into a heap
      const b = this.sheetMesh.geometry.boundingBox ?? (this.sheetMesh.geometry.computeBoundingBox(), this.sheetMesh.geometry.boundingBox!);
      this.sheetMesh.visible = false;
      const c = b.getCenter(new THREE.Vector3());
      this.block(c.setY(Math.max(floorY, c.y)), 0.4);
    }
    fall(this.blockMesh, 0);
  }

  setVisible(v: boolean): void { this.root.visible = v; }

  dispose(): void {
    this.sound(false, null);
    this.root.removeFromParent();
    if (this.sheetMesh) { this.sheetMesh.geometry.dispose(); (this.sheetMesh.material as THREE.Material).dispose(); }
  }
}
