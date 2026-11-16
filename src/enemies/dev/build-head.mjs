#!/usr/bin/env node
/**
 * Dev tool (not part of the game bundle): packs Tomas's head asset `public/models/tomas-head.glb`.
 *
 * Source: three.js examples, `examples/models/gltf/LeePerrySmith/` — "Infinite, 3D Head Scan" by Lee Perry-Smith,
 * CC BY 3.0 (see docs/ASSETS.md). Inputs (downloaded by hand from that folder into one directory):
 *   LeePerrySmith.glb, Map-COL.jpg, Infinite-Level_02_Tangent_SmoothUV.jpg
 * The colour map is pre-processed with ImageMagick (stubble softened, tone warmed):
 *   magick -size 1024x1024 xc:black -fill white -draw "ellipse 512,640 250,230 0,360" -draw "rectangle 300,600 724,1024" -blur 0x40 mask.png
 *   magick Map-COL.jpg -statistic median 7x7 -blur 0x2 \( mask.png -evaluate multiply 0.8 \) -alpha off -compose CopyOpacity -composite blurA.png
 *   magick Map-COL.jpg blurA.png -compose over -composite -modulate 97,106,100 -fill "#c28f74" -colorize 10% -quality 90 col_tomas.jpg
 *   magick col_tomas.jpg -flip -quality 90 col_flip.jpg
 *   magick Infinite-Level_02_Tangent_SmoothUV.jpg -flip -channel G -negate +channel -quality 88 nrm.jpg
 * (flipped because the scan's UVs were authored for flipY = true images, and glTF images are uploaded unflipped)
 * Usage: node src/enemies/dev/build-head.mjs <dir with LeePerrySmith.glb, col_flip.jpg, nrm.jpg> public/models/tomas-head.glb
 * All shaping (scale, trim, eye openings, jaw weights, hair shell) happens at load time in src/enemies/human/head.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: build-head.mjs <srcdir> <out.glb>'); process.exit(1); }

const src = fs.readFileSync(path.join(dir, 'LeePerrySmith.glb'));
const jl = src.readUInt32LE(12);
const sj = JSON.parse(src.subarray(20, 20 + jl).toString());
const binLen = src.readUInt32LE(20 + jl);
const sbin = src.subarray(20 + jl + 8, 20 + jl + 8 + binLen);
const prim = sj.meshes[0].primitives[0];

const chunks = [];
let off = 0;
const views = [];
const pushView = (buf, target) => {
  const pad = (4 - (off % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
  views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf); off += buf.length;
  return views.length - 1;
};
const accessors = [];
const copyAcc = (i, target) => {
  const a = sj.accessors[i], bv = sj.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : 4;
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const v = pushView(Buffer.from(sbin.subarray(start, start + a.count * n * size)), target);
  accessors.push({ bufferView: v, componentType: a.componentType, count: a.count, type: a.type, ...(a.min ? { min: a.min, max: a.max } : {}) });
  return accessors.length - 1;
};
const POSITION = copyAcc(prim.attributes.POSITION, 34962);
const NORMAL = copyAcc(prim.attributes.NORMAL, 34962);
const TEXCOORD_0 = copyAcc(prim.attributes.TEXCOORD_0, 34962);
const indices = copyAcc(prim.indices, 34963);
const imgCol = pushView(fs.readFileSync(path.join(dir, 'col_flip.jpg')));
const imgNrm = pushView(fs.readFileSync(path.join(dir, 'nrm.jpg')));

const json = {
  asset: { version: '2.0', generator: 'cold-boot build-head.mjs', copyright: 'Infinite, 3D Head Scan by Lee Perry-Smith (www.ir-ltd.net), CC BY 3.0 — modified (texture tone) for COLD BOOT' },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'tomas_head' }],
  meshes: [{ name: 'tomas_head', primitives: [{ attributes: { POSITION, NORMAL, TEXCOORD_0 }, indices, material: 0 }] }],
  materials: [{ name: 'tomas_head_skin', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 }, normalTexture: { index: 1 } }],
  textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ bufferView: imgCol, mimeType: 'image/jpeg' }, { bufferView: imgNrm, mimeType: 'image/jpeg' }],
  accessors, bufferViews: views,
  buffers: [{ byteLength: 0 }],
};
let bin = Buffer.concat(chunks);
const binPad = (4 - (bin.length % 4)) % 4;
bin = Buffer.concat([bin, Buffer.alloc(binPad)]);
json.buffers[0].byteLength = bin.length;
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, jh, js, bh, bin]));
console.log('wrote', out, (12 + 8 + js.length + 8 + bin.length), 'bytes');
