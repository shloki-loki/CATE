# Neon Coast

An **original** open-world driving game for the desktop browser, set in a sunny
fictional 1980s coastal city. It is built from scratch by CATE agents with
TypeScript, [Three.js](https://threejs.org) (WebGL2) and
[Rapier](https://rapier.rs) physics. It is a game in the same genre as classic
open-world crime games, not a copy of one: no third-party names, maps, characters,
music or assets.

Architecture: `data/outputs/T0016.md` (approved). Engine choice: `data/outputs/T0017.md`.

## Run it

Requires Node.js 20.19+ (tested with Node 24) and a browser with WebGL2 (current
Chrome, Edge or Firefox).

```bash
cd game
npm ci
npm run dev        # http://localhost:5173 with hot reload
```

Production build (static files in `dist/`, works from any sub-path):

```bash
npm run build
npm run preview    # http://localhost:4173
```

Controls in the skeleton scene: drag with the mouse to orbit, mouse wheel to
zoom, WASD/arrow keys to move the view, Shift to move faster, F3 to toggle
the debug overlay.

## Scripts

| Command                           | What it does                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server                                                                                                                                                                                       |
| `npm run build`                   | Type-check (`tsc`) then build to `dist/`                                                                                                                                                              |
| `npm run preview`                 | Serve `dist/` on port 4173                                                                                                                                                                            |
| `npm test`                        | Vitest unit tests, including Rapier in Node and the module-boundary rules                                                                                                                             |
| `npm run test:e2e`                | Playwright smoke test: builds, boots in headless Chromium, checks the scene renders and there are no console errors. Needs `npx playwright install chromium` once, or `CHROMIUM_PATH=/path/to/chrome` |
| `npm run lint`                    | ESLint                                                                                                                                                                                                |
| `npm run format` / `format:check` | Prettier                                                                                                                                                                                              |
| `npm run check`                   | typecheck + lint + unit tests + build (run before every PR)                                                                                                                                           |

## Layout

```
game/
  index.html  package.json  tsconfig.json  vite.config.ts  eslint.config.js  playwright.config.ts
  assets/            source assets for the generators (not served)
  public/            served as-is: favicon, THIRD_PARTY_NOTICES.txt
    assets/          generated .glb/.ktx2 + manifest.json (T0018)
  tools/             build-time asset generators (T0018)
  src/
    main.ts          boot only
    services.ts      the Services object every system receives
    core/            loop, ECS world, event bus, settings, time of day, log
    input/           keyboard/mouse -> actions
    physics/         PhysicsAPI + rapier/ (the ONLY place that imports Rapier)
    render/          RenderAPI + Three.js WebGL2 renderer, lighting, view sync
    audio/           AudioAPI (NullAudio until the audio task)
    assets/          AssetAPI + manifest registry
    ui/              DOM overlay (debug overlay, fatal screen)
    game/
      components.ts  ALL shared component types
      events.ts      ALL event types
      shared/        physics step/sync, view sync, time-of-day systems
      camera/        debug orbit camera (replaced by T0020/T0021 cameras)
      demo/          the skeleton scene (kept for tests; the game now loads the T0022 city)
      world/ (procedural city, T0022) player/ vehicles/ ai/ combat/ wanted/ missions/ save/   (owned by later tasks)
  tests/
    unit/            Vitest
    e2e/             Playwright smoke test
```

## Module rules (enforced by `tests/unit/boundaries.test.ts`)

1. `core/` imports nothing from the project; only `three` maths.
2. `@dimforge/rapier3d-compat` only in `physics/rapier/`.
3. Three.js scene objects and addons only in `render/`, `assets/`,
   `game/world/cityMesher.ts` and `*View.ts` files. Elsewhere, only `three` maths
   classes or `import type`.
4. `ui/` never imports `game/`.
5. `game/<a>/` never imports `game/<b>/`. Use `game/components.ts`,
   `game/events.ts` and `game/shared/`.
6. Another module is imported only through its `index.ts`.

## Frame order

Fixed 60 Hz simulation (max 5 sub-steps per frame), then one render per animation
frame with interpolation:

`input → preSim → physics → postSim → ai → gameplay → events.flush()`, then
`camera → render (view sync) → ui → renderer.render()`.

## Debugging

- F3 overlay: fps, draw calls, triangles, physics bodies, entities, game time.
- `window.__neon`: read-only boot status (all builds; used by the smoke test).
- `window.__game`: full `{ services, world, loop }` handle in dev builds only.
