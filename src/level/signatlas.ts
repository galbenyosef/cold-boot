/**
 * Sign atlas: every text sign in a static zone used to be its own material (own canvas texture) and
 * therefore its own draw call — ~20 in a fab view. Here the sign canvases produced by the material
 * library are packed into one texture pair (albedo + roughness) per sign style, so all signs of a
 * style in a zone merge into a single mesh.
 */
import * as THREE from 'three';
import type { SignStyle } from '../core/types';

/** UV transform of one sign inside its atlas (filled in by `SignAtlas.finish`). */
export interface UvRect { ou: number; ov: number; su: number; sv: number }

interface Slot { src: THREE.MeshStandardMaterial; x: number; y: number; w: number; h: number; rect: UvRect }
interface StyleAtlas { mat: THREE.MeshStandardMaterial; slots: Slot[]; byKey: Map<string, Slot>; x: number; y: number; rowH: number }

const WIDTH = 2048;
const GUTTER = 6;

export class SignAtlas {
  private styles = new Map<SignStyle, StyleAtlas>();
  /** Sign canvases are packed at this scale (phones: 0.5 — a quarter of the atlas memory). */
  constructor(private readonly scale = 1) {}

  /** Reserve (or reuse) a slot for a sign material made by `materials.sign()`; null if it cannot be atlased. */
  entry(key: string, style: SignStyle, src: THREE.MeshStandardMaterial): { mat: THREE.MeshStandardMaterial; rect: UvRect } | null {
    const img = src.map?.image as HTMLCanvasElement | undefined;
    if (!img || !img.width || !img.height || img.width + GUTTER * 2 > WIDTH) return null;
    let a = this.styles.get(style);
    if (!a) {
      const mat = src.clone();
      mat.name = src.name;
      this.styles.set(style, (a = { mat, slots: [], byKey: new Map(), x: 0, y: 0, rowH: 0 }));
    }
    let slot = a.byKey.get(key);
    if (!slot) {
      const iw = Math.max(1, Math.round(img.width * this.scale)), ih = Math.max(1, Math.round(img.height * this.scale));
      const w = iw + GUTTER * 2, h = ih + GUTTER * 2;
      if (a.x + w > WIDTH) { a.x = 0; a.y += a.rowH; a.rowH = 0; }
      slot = { src, x: a.x + GUTTER, y: a.y + GUTTER, w: iw, h: ih, rect: { ou: 0, ov: 0, su: 1, sv: 1 } };
      a.x += w;
      a.rowH = Math.max(a.rowH, h);
      a.slots.push(slot);
      a.byKey.set(key, slot);
    }
    return { mat: a.mat, rect: slot.rect };
  }

  /** Source sign materials that went into an atlas (their canvases can be released after `finish`). */
  sources(): THREE.MeshStandardMaterial[] {
    const out: THREE.MeshStandardMaterial[] = [];
    for (const a of this.styles.values()) for (const s of a.slots) out.push(s.src);
    return out;
  }

  /** Draw the atlases and resolve every slot's UV rectangle. Call once, before the zones are merged. */
  finish(): void {
    for (const a of this.styles.values()) {
      const W = WIDTH, H = Math.max(4, Math.ceil((a.y + a.rowH) / 4) * 4);
      const first = a.slots[0].src;
      const make = (pick: (m: THREE.MeshStandardMaterial) => THREE.Texture | null, like: THREE.Texture | null): THREE.CanvasTexture | null => {
        if (!like) return null;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const g = cv.getContext('2d')!;
        for (const s of a.slots) {
          const img = pick(s.src)?.image as CanvasImageSource | undefined;
          if (!img) continue;
          // stretched copy underneath fills the gutter with edge colours (keeps mips from bleeding neighbours in)
          g.drawImage(img, s.x - GUTTER, s.y - GUTTER, s.w + GUTTER * 2, s.h + GUTTER * 2);
          g.clearRect(s.x, s.y, s.w, s.h);
          g.drawImage(img, s.x, s.y, s.w, s.h);
        }
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = like.colorSpace;
        t.anisotropy = like.anisotropy;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.name = `sign_atlas:${a.mat.name}`;
        // The atlas canvas is only needed for the upload; drop its pixels once they are on the GPU (an iPhone
        // tab is killed well below what these canvases plus their GPU copies cost). No context-loss restore exists.
        t.onUpdate = () => { t.onUpdate = null; cv.width = cv.height = 1; };
        return t;
      };
      a.mat.map = make((m) => m.map, first.map);
      a.mat.roughnessMap = make((m) => m.roughnessMap, first.roughnessMap);
      a.mat.needsUpdate = true;
      for (const s of a.slots) {
        s.rect.su = s.w / W; s.rect.sv = s.h / H;
        s.rect.ou = s.x / W; s.rect.ov = (H - s.y - s.h) / H; // canvas textures are flipped in Y
      }
    }
  }
}
