# COLD BOOT

Browser FPS-horror (three.js r187, TypeScript, Vite). Read `docs/DESIGN.md` (design bible, level
coordinates, ids) and `src/core/types.ts` (the contract) before touching anything.

- `npm run dev` — dev server. `npm run typecheck`. `npm run build`.
- `node scripts/shot.mjs --url "http://127.0.0.1:<port>/?autostart=1&spawn=0,0,7,0" --out shots/x.png`
  — headless GPU screenshot + console errors + perf numbers. Look at the PNG with the Read tool.
- Module ownership: one folder per system under `src/` (`render`, `materials`, `fx`, `audio`, `level`,
  `player`, `enemies`, `ui`, `story`); each exports `createX(ctx)` from `index.ts`.
  `src/core`, `src/physics`, `src/main.ts`, `index.html`, `docs/`, `scripts/` belong to the coordinator.
- Everything is procedural: no asset files, no runtime network requests.
- Lights only through `ctx.render.lights`; materials through `ctx.materials`.
