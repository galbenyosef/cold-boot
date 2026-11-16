# Third-party assets

Everything in COLD BOOT is procedural except the recorded voices (`public/voice/`, generated in-house) and the
assets listed here (R7: ready-made only where procedural is weak and it matters, licence verified at the source).

## `public/models/tomas-head.glb` — Tomas's head (level 2)

| | |
|---|---|
| Work | "Infinite, 3D Head Scan" |
| Author | Lee Perry-Smith (Infinite Realities, http://www.ir-ltd.net/) |
| Source | three.js examples: https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/LeePerrySmith (`LeePerrySmith.glb`, `Map-COL.jpg`, `Infinite-Level_02_Tangent_SmoothUV.jpg`) |
| Licence | Creative Commons Attribution 3.0 Unported (CC BY 3.0) — https://creativecommons.org/licenses/by/3.0/ |
| Licence text at source | `LeePerrySmith_License.txt` in that folder: "Infinite, 3D Head Scan by Lee Perry-Smith is licensed under a Creative Commons Attribution 3.0 Unported License. Based on a work at www.triplegangers.com. Permissions beyond the scope of this license may be available at http://www.ir-ltd.net/ — Please remember: Do what you want with the files, but always mention where you got them from..." |
| Requirement | Attribution (credit line below must appear in the game's credits / about text). Changes must be indicated. |
| Changes | Colour map: stubble removed / softened and tone warmed; colour + normal map flipped vertically to match the scan's UVs under glTF conventions (ImageMagick, commands in `src/enemies/dev/build-head.mjs`); repacked into one GLB. At load (`src/enemies/human/head.ts`): rescaled and fitted to the procedural body, jaw narrowed slightly, trimmed at the collar, eye openings cut (the scan's closed lids are kept for blinks), new eyeballs + lid margins, lips seam-split so they part only when the jaw opens, skinned to head/jaw/brow/neck bones, a knitted watch cap grown from the scalp. |
| Size shipped | 586 844 bytes (geometry 9 279 vertices + two 1024² JPEG maps). No decoders needed. |
| Loaded | level 2 only, by `createEnemies`; the procedural head is used if it fails or takes > 12 s. |

**Credit line:** Tomas's head is based on "Infinite, 3D Head Scan" by Lee Perry-Smith (www.ir-ltd.net), licensed
CC BY 3.0, modified.

### Evaluated and not used
- `examples/models/gltf/facecap.glb` (three.js examples, "model by Face Cap" / bannaflak.com) — has ARKit blend
  shapes, needs KTX2 + meshopt decoders; **no licence statement found** at the source (bannaflak.com/face-cap page,
  the three.js PR #22514 that added it). Not shipped (R7).
- Searches for CC0 realistic male heads turned up only paid marketplace assets; MakeHuman output is CC0 but no
  tool to run it is available here.
