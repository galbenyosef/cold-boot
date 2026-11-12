/**
 * World pickups: weapon props lying on their side, labelled ammo boxes, medkits, keycards.
 * Weapons/keycards are interactables ("Take pistol"); ammo/medkits are collected on touch when needed.
 * Idle highlight: a soft, slowly twinkling glint — no arcade spinning.
 */
import * as THREE from 'three';
import type { GameContext, PickupKind, PickupSpawn } from '../core/types';
import type { VmMats } from './viewmodels/mats';
import { buildPistol } from './viewmodels/pistol';
import { buildShotgun } from './viewmodels/shotgun';
import { buildShell, buildCasingGeo } from './viewmodels/props';
import { M, Parts, rbox, cylY } from './geom';

export interface PickupHost {
  /** Would the player take this right now (auto-collect kinds)? */
  wants(kind: PickupKind): boolean;
  give(kind: PickupKind, amount: number): void;
  addKey(key: string): void;
}

interface Item {
  spawn: PickupSpawn;
  obj: THREE.Object3D;
  glint: THREE.Sprite;
  center: THREE.Vector3;
  phase: number;
  auto: boolean;
  taken: boolean;
}

const PROMPTS: Partial<Record<PickupKind, string>> = { pistol: 'Take pistol', shotgun: 'Take shotgun', keycard: 'Take keycard' };

let glintTex: THREE.Texture | null = null;
function makeGlintTexture(): THREE.Texture {
  const S = 64, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const rad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.12, 'rgba(220,235,255,0.6)');
  rad.addColorStop(1, 'rgba(160,190,255,0)');
  g.fillStyle = rad; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[S, 2], [2, S]]) {
    const lg = g.createLinearGradient(0, 0, w > h ? S : 0, w > h ? 0 : S);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect((S - w) / 2, (S - h) / 2, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Pickups {
  readonly root = new THREE.Group();
  private items: Item[] = [];
  private glintMat: THREE.SpriteMaterial;
  private protos = new Map<PickupKind, THREE.Object3D>();
  private seq = 0;

  constructor(private ctx: GameContext, private m: VmMats, private host: PickupHost) {
    this.root.name = 'pickups';
    ctx.scene.add(this.root);
    glintTex ??= makeGlintTexture();
    this.glintMat = new THREE.SpriteMaterial({ map: glintTex, color: new THREE.Color(1.6, 1.7, 2.0), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  }

  private proto(kind: PickupKind): THREE.Object3D {
    let p = this.protos.get(kind);
    if (p) return p;
    const m = this.m, lib = this.ctx.materials;
    const g = new THREE.Group();
    switch (kind) {
      case 'pistol': {
        const gun = buildPistol(m).root;
        gun.rotation.set(0, 0, Math.PI / 2);
        g.add(gun);
        break;
      }
      case 'shotgun': {
        const gun = buildShotgun(m).root;
        gun.rotation.set(0, 0, Math.PI / 2);
        g.add(gun);
        break;
      }
      case 'ammo_pistol':
      case 'ammo_shotgun': {
        const pistol = kind === 'ammo_pistol';
        const w = pistol ? 0.15 : 0.16, h = pistol ? 0.055 : 0.075, d = pistol ? 0.095 : 0.105;
        const pp = new Parts();
        pp.add(rbox(w, h * 0.78, d, 0.004), m.polymer, M(0, h * 0.39, 0));
        pp.add(rbox(w + 0.004, h * 0.26, d + 0.004, 0.004), m.polymer, M(0, h * 0.87, 0)); // lid
        pp.add(rbox(w * 0.3, 0.004, 0.012, 0.0015), m.rubber, M(0, h + 0.002, 0)); // lid tab
        pp.build(g);
        const label = lib.sign(pistol ? '9MM  FMJ  ×24' : '12 GA  00 BUCK', 'label', 3.2);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, w * 0.86 / 3.2), label);
        front.position.set(0, h * 0.42, d / 2 + 0.0012);
        g.add(front);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, w * 0.7 / 3.2), label);
        top.rotation.x = -Math.PI / 2;
        top.position.set(0, h + 0.0012, 0.01);
        g.add(top);
        // a few loose rounds beside the box
        if (pistol) {
          const cg = buildCasingGeo();
          for (let i = 0; i < 3; i++) {
            const c = new THREE.Mesh(cg, m.brass);
            c.rotation.set(Math.PI / 2, 0, 0.4 + i * 0.9);
            c.position.set(w / 2 + 0.03 + i * 0.014, 0.005, -0.02 + i * 0.022);
            g.add(c);
          }
        } else {
          const sh = buildShell(m);
          for (let i = 0; i < 2; i++) {
            const s = sh.clone();
            s.rotation.set(Math.PI / 2, 0, 0.3 + i * 1.1);
            s.position.set(w / 2 + 0.035 + i * 0.03, 0.011, -0.025 + i * 0.04);
            g.add(s);
          }
        }
        break;
      }
      case 'medkit': {
        const pp = new Parts();
        const W = 0.3, H = 0.1, D = 0.2;
        pp.add(rbox(W, H * 0.55, D, 0.012, 3), m.plasticWhite, M(0, H * 0.275, 0));
        pp.add(rbox(W + 0.004, H * 0.45, D + 0.004, 0.012, 3), m.plasticWhite, M(0, H * 0.775, 0));
        pp.add(rbox(W + 0.006, 0.008, D + 0.006, 0.003), m.polymer, M(0, H * 0.55, 0)); // seam band
        for (const sx of [-1, 1]) {
          pp.add(rbox(0.03, 0.03, 0.012, 0.003), m.steel, M(sx * 0.09, H * 0.55, D / 2 + 0.006)); // latches
          pp.add(rbox(0.02, 0.022, 0.02, 0.004), m.polymer, M(sx * 0.07, H + 0.012, 0)); // handle posts
        }
        pp.add(rbox(0.16, 0.014, 0.022, 0.006), m.rubber, M(0, H + 0.026, 0)); // handle
        // emissive cross on the lid + side
        pp.add(new THREE.BoxGeometry(0.075, 0.003, 0.022), m.emGreen, M(0, H + 0.0005, -0.02));
        pp.add(new THREE.BoxGeometry(0.022, 0.003, 0.075), m.emGreen, M(0, H + 0.0005, -0.02));
        pp.add(new THREE.BoxGeometry(0.05, 0.015, 0.002), m.emRed, M(-0.08, H * 0.3, D / 2 + 0.002));
        pp.add(new THREE.BoxGeometry(0.015, 0.05, 0.002), m.emRed, M(-0.08, H * 0.3, D / 2 + 0.002));
        pp.build(g);
        const label = lib.sign('TRAUMA KIT', 'label', 3);
        const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), label);
        lab.position.set(0.05, H * 0.3, D / 2 + 0.0015);
        g.add(lab);
        break;
      }
      case 'keycard': {
        const pp = new Parts();
        pp.add(rbox(0.086, 0.0022, 0.054, 0.001), m.plasticWhite, M(0, 0.0011, 0));
        pp.add(new THREE.BoxGeometry(0.086, 0.0004, 0.01), m.emCyan, M(0, 0.0024, -0.016));
        pp.add(new THREE.BoxGeometry(0.012, 0.0006, 0.01), m.brass, M(-0.026, 0.0025, 0.008));
        pp.add(cylY(0.0035, 0.0006, 12), m.polymer, M(0.032, 0.0025, 0.014));
        pp.build(g);
        break;
      }
    }
    // rest on y = 0
    const bb = new THREE.Box3().setFromObject(g);
    const holder = new THREE.Group();
    g.position.y = -bb.min.y;
    holder.add(g);
    holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.protos.set(kind, holder);
    return holder;
  }

  spawn(sp: PickupSpawn) {
    const obj = this.proto(sp.kind).clone();
    obj.position.copy(sp.position);
    obj.rotation.y = sp.yaw ?? 0;
    obj.name = `pickup_${sp.id}`;
    this.root.add(obj);
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    const center = bb.getCenter(new THREE.Vector3());
    const glint = new THREE.Sprite(this.glintMat);
    glint.position.set(center.x, bb.max.y + 0.01, center.z);
    glint.scale.setScalar(0.0001);
    glint.renderOrder = 5;
    this.root.add(glint);
    const auto = !(sp.kind in PROMPTS);
    const item: Item = { spawn: sp, obj, glint, center, phase: Math.random() * 10, auto, taken: false };
    this.items.push(item);
    if (!auto) {
      this.ctx.interactables.add({
        id: sp.id, kind: 'pickup', position: center, radius: 2.2, prompt: PROMPTS[sp.kind]!, enabled: true,
        onUse: () => this.collect(item),
      });
    }
  }

  /** Spawn a pickup at runtime (debug / story). */
  add(kind: PickupKind, position: THREE.Vector3, amount = 0, yaw = 0, id?: string) {
    this.spawn({ id: id ?? `pk_${kind}_${this.seq++}`, kind, position: position.clone(), amount, yaw });
  }

  /** Checkpoints: ids of every pickup collected so far (level spawns and runtime ones alike). */
  readonly collected: string[] = [];

  /** Checkpoints: silently remove already-collected pickups (no give, no events). */
  restoreCollected(ids: readonly string[]) {
    const want = new Set(ids);
    for (const it of this.items) {
      if (it.taken || !want.has(it.spawn.id)) continue;
      it.taken = true;
      this.root.remove(it.obj, it.glint);
      if (!it.auto) this.ctx.interactables.remove(it.spawn.id);
    }
    for (const id of ids) if (!this.collected.includes(id)) this.collected.push(id);
  }

  private collect(it: Item) {
    if (it.taken) return;
    it.taken = true;
    const sp = it.spawn;
    this.collected.push(sp.id);
    if (sp.kind === 'keycard') this.host.addKey(sp.id);
    this.host.give(sp.kind, sp.amount);
    this.ctx.events.emit('pickup', { kind: sp.kind, amount: sp.amount, position: it.center.clone() });
    this.root.remove(it.obj, it.glint);
    if (!it.auto) this.ctx.interactables.remove(sp.id);
  }

  update(dt: number, t: number, feet: THREE.Vector3, alive: boolean) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.taken) { this.items.splice(i, 1); continue; }
      // glint: brief soft twinkle every few seconds
      const cyc = (t * 0.32 + it.phase) % 1;
      const k = cyc < 0.12 ? Math.sin((cyc / 0.12) * Math.PI) : 0;
      it.glint.scale.setScalar(0.02 + k * 0.11);
      it.glint.material.rotation = t * 0.3;
      if (!alive || !it.auto) continue;
      const dx = it.center.x - feet.x, dz = it.center.z - feet.z, dy = it.center.y - feet.y;
      if (dx * dx + dz * dz < 1.0 && dy > -0.6 && dy < 1.4 && this.host.wants(it.spawn.kind)) this.collect(it);
    }
    void dt;
  }

  get remaining() { return this.items.filter((i) => !i.taken).map((i) => i.spawn); }
}
