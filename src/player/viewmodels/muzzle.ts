/** Muzzle flash: crossed additive cards with a procedural burst texture, HDR colour for bloom. */
import * as THREE from 'three';

let tex: THREE.Texture | null = null;
let sideTex: THREE.Texture | null = null;

function burstTexture(side: boolean): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  if (!side) {
    // front: star burst with a hot core
    const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.28);
    core.addColorStop(0, 'rgba(255,255,240,1)');
    core.addColorStop(0.35, 'rgba(255,200,120,0.85)');
    core.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, S, S);
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + (i % 2) * 0.2;
      const len = S * (0.32 + (i % 3) * 0.06);
      g.save();
      g.translate(S / 2, S / 2);
      g.rotate(a);
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,230,170,0.9)');
      gr.addColorStop(1, 'rgba(255,110,20,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, -S * 0.035); g.lineTo(len, 0); g.lineTo(0, S * 0.035); g.closePath();
      g.fill();
      g.restore();
    }
  } else {
    // side: elongated plume (u along barrel axis: left = muzzle)
    for (let k = 0; k < 3; k++) {
      const cx = S * (0.12 + k * 0.22), r = S * (0.2 - k * 0.04);
      const gr = g.createRadialGradient(cx, S / 2, 0, cx, S / 2, r);
      gr.addColorStop(0, `rgba(255,${235 - k * 30},${190 - k * 50},${0.95 - k * 0.2})`);
      gr.addColorStop(0.5, `rgba(255,150,50,${0.45 - k * 0.1})`);
      gr.addColorStop(1, 'rgba(255,90,10,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(cx, S / 2, r * 1.35, r * 0.75, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MuzzleFlash {
  readonly root = new THREE.Group();
  private front: THREE.Mesh;
  private sides: THREE.Mesh[] = [];
  private timer = 0;
  private readonly mats: THREE.MeshBasicMaterial[] = [];

  constructor(private size: number, private length: number, color = new THREE.Color(1.0, 0.62, 0.3), hdr = 7) {
    tex ??= burstTexture(false);
    sideTex ??= burstTexture(true);
    const mk = (map: THREE.Texture) => {
      const m = new THREE.MeshBasicMaterial({
        map, color: color.clone().multiplyScalar(hdr), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      this.mats.push(m);
      return m;
    };
    this.front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mk(tex));
    this.root.add(this.front);
    const sideGeo = new THREE.PlaneGeometry(1, 1);
    sideGeo.translate(0.5, 0, 0);
    sideGeo.rotateY(Math.PI / 2); // extends along -Z? (x→ -z after +90° about Y)
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(sideGeo, mk(sideTex));
      s.rotation.z = (i * Math.PI) / 2;
      this.root.add(s);
      this.sides.push(s);
    }
    this.root.visible = false;
    this.root.traverse((o) => { o.frustumCulled = false; o.renderOrder = 10; });
  }

  fire() {
    this.timer = 0.034 + Math.random() * 0.018;
    const s = this.size * (0.75 + Math.random() * 0.5);
    this.front.scale.set(s, s, s);
    this.front.rotation.z = Math.random() * Math.PI * 2;
    const l = this.length * (0.7 + Math.random() * 0.6);
    for (const sd of this.sides) sd.scale.set(s * 0.8, s * 0.9, l);
    this.root.rotation.z = Math.random() * Math.PI;
    this.root.visible = true;
  }

  update(dt: number) {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.root.visible = false;
  }
}
