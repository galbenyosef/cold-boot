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
- Searches for CC0 realistic male heads turned up only paid marketplace assets. (MakeHuman's CC0 data was later used
  without the MakeHuman program for Halvorsen's head, below.)

## `public/models/halvorsen-head.glb` — Halvorsen's head (level 3)

Not a scan: no second licensed photo-scan of an older man could be found that may be redistributed (see below). The
head is built from MakeHuman's CC0 data — its parametric base mesh morphed to a ~58-year-old heavy-set man, with its
CC0 "old caucasian male" skin — by our own script (no MakeHuman program code is used or shipped).

| | |
|---|---|
| Work | MakeHuman 1.x assets: base mesh `hm08` (`base.obj`) + morph targets; system asset pack skin `old_caucasian_male` (`old_lightskinned_male_diffuse.png`) and eyebrows `eyebrow009` |
| Author | MakeHuman team (copyright holders at the CC0 release: Data Collection AB, Joel Palmius, Jonas Hauquier; targets originally © 2014 Manuel Bastioni) — www.makehumancommunity.org |
| Source | Mesh + targets: https://github.com/makehumancommunity/makehuman — `makehuman/data/3dobjs/base.obj`, `makehuman/data/targets/{macrodetails,head,nose,chin,neck,eyes,mouth,forehead,eyebrows,cheek,ears}/*.target`. Skin + eyebrows: the official system asset pack https://mirror1.makehuman.net/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip (the URL MakeHuman II itself downloads: `url_systemassets` in https://github.com/makehumancommunity/makehuman2/blob/main/data/makehuman2_version.json) |
| Licence | CC0 1.0 Universal (public domain dedication) — https://creativecommons.org/publicdomain/zero/1.0/ |
| Licence text at source | `LICENSE.md` in the makehuman repo, section C: "The assets are defined as any data contributing to the graphical output of MakeHuman. This includes: * The base mesh and proxies * Targets and modifiers * Textures * Clothes (any MHCLO-based asset) * Poses and expressions. These assets have been released under CC0 1.0 Universal. In summary this means that to the fullest extent possible, it is the intention of the MakeHuman project that anyone can do whatever they want with it." Full legal text: `LICENSE.ASSETS.md` (the CC0 1.0 deed). Every data file repeats it, e.g. the header of `base.obj`, `*.target`, `old_caucasian_male.mhmat`, `eyebrow009.mhclo`: "This asset was explicitly released as CC0 in september 2020. The license text for CC0 can be found in the root of this repository." The pack's index `packs/makehuman_system_assets.json` lists both `old_caucasian_male` and `eyebrow009` with `"license": "CC0"`; the skin image itself carries a "PUBLICDOMAIN · MAKEHUMAN.ORG" mark. |
| Requirement | None (CC0). We credit anyway (line below). Note: CC0 waives copyright, not personality rights; the skin texture is a painted/photo-derived MakeHuman stock skin, re-projected onto a morphed generic mesh and re-coloured, so it does not reproduce an identifiable person. |
| Changes | Geometry: hm08 morphed (macro: male, age slider 0.754 ≈ 58 y, caucasian, weight 0.68; face targets for a broader square face, heavier jaw, double chin, longer heavier nose, eye bags, mouth corners down, lower brows, bigger ears — exact weights in `src/enemies/dev/build-head2.mjs`), head + neck cut from the body above the clavicles, body/helper geometry (eyeballs, teeth, tongue, lashes) dropped, one Catmull–Clark step on the skin, converted to metres. Texture: head island (plus the throat strip from the torso island) cropped and repacked into one 768×1280 map; scalp hair greyed and the crown/temples thinned to bare scalp (receding), stubble greyed, the eyelids' red cast removed, a little ruddiness on nose/cheeks, overall saturation reduced; eyebrow009 fitted from its `.mhclo` and baked in salt-and-pepper grey; a normal map derived from the colour map's fine detail. All by `src/enemies/dev/build-head2.mjs` (commands and inputs in its header). |
| Size shipped | 971 104 bytes (14 783 vertices, 28 880 triangles; 768×1280 JPEG colour + normal maps). No decoders needed. |
| Loaded | level 3, by `src/enemies/index.ts` (`actor(..., { who: "halvorsen" })`); a procedural head is used if it fails to load. |

**Credit line:** Halvorsen's head is built from MakeHuman assets (base mesh, morph targets, skin, eyebrows) by the
MakeHuman team, www.makehumancommunity.org, released CC0 1.0, modified.

### Evaluated and not used (Halvorsen)
- Smithsonian Lincoln life masks (Volk 1860, NPG.71.24; Mills 1865, NPG.71.26, 3d.si.edu) — tagged CC0 on the
  Smithsonian records (as reported by search results; the record pages were not re-read here). Not used: the face of
  a famous real person, face-only (no skull/ears/back), and a plaster surface with no skin texture.
- three.js `examples/models/gltf/tennyson-bust.glb` — credited in the example to Three D Scans
  (threedscans.com/lincoln/tennyson/); no licence or terms statement found on the pages read (the "info" page and the
  object page). A marble bust of a real person, no skin texture. Not used.
- three.js `examples/models/obj/walt/WaltHead.obj` — no licence file or credit in the folder; untextured sculpt of a
  real person. Not used.
- three.js `examples/models/obj/male02/` — readme: "Model by Reallusion iClone from Google 3d Warehouse"; low poly,
  licence not stated (3D Warehouse terms, not a CC licence). Not used.
- Ten24 / 3D Scan Store free head scans — non-commercial licence only, download behind a newsletter sign-up. Not used.
- CGTrader / RenderHub / ArtStation "male 50s–70s head scan" products — paid marketplace licences. Not used.
- Sketchfab CC0 / CC BY scans, MyMiniFactory "Scan the World" — downloads need an account (MyMiniFactory's mirror of the
  Smithsonian Lincoln mask even shows NC-SA, contradicting the source). Not used.
- Academic face datasets (FLAME, Basel Face Model, FaceScape, Multiface …) — research / non-commercial terms without
  redistribution; not pursued (terms not re-read in this session).
- Poly Haven, Khronos glTF sample assets — no realistic human head in either (Khronos list not re-checked
  exhaustively). three.js's other heads are Tomas's own scan (LeePerrySmith) and facecap (above).
