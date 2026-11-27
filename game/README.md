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

Controls (on foot, T0021):

| Input             | Action                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| WASD / arrow keys | Move (relative to the camera)                                            |
| Shift             | Sprint                                                                   |
| Space             | Jump                                                                     |
| F                 | Enter / exit the nearest vehicle, or use the nearest interactable object |
| Click the game    | Capture the mouse for mouse look (Esc releases it). Dragging also works. |
| Mouse wheel       | Camera distance                                                          |
| F3                | Debug overlay                                                            |

You spawn east of downtown next to a small test playground: stairs, a ramp, a
too-steep slope, a 1 m ledge to jump onto, a low roof, a long wall and some
crates to push. The pink car near the central crossing can be entered with F
(it does not drive until the vehicle task, T0020).

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
      camera/        follow camera (spring arm + collision, T0021); debug orbit camera
      player/        on-foot controller, jump, interaction, enter/exit vehicle, mannequin view (T0021)
      demo/          the skeleton scene + on-foot playground (replaced by T0022's procedural city)
      world/ vehicles/ ai/ combat/ wanted/ missions/ save/   (owned by later tasks)
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

## Character controller and follow camera (T0021)

- **Physics** (`PhysicsAPI`): `createCharacter` makes a kinematic capsule driven by
  Rapier's `KinematicCharacterController` (autostep 0.45 m, 50° slope limit,
  snap-to-ground, pushes dynamic bodies); `moveCharacter(handle, delta, yaw)`
  collides, slides and steps; `placeCharacter` teleports; `castSphere` sweeps a
  sphere (camera arm, exit clearance); `setBodyEnabled` parks the capsule while
  the player is in a car.
- **Player** (`game/player/`): `createPlayer` + `PlayerSystems()`. Movement maths
  are in `motor.ts` (`MOTOR` holds all tuning: jog 4.6 m/s, sprint 7.2 m/s,
  acceleration, 1.15 m jump, coyote time, jump buffer). States live on the
  `Character` component (`idle/walk/run/sprint/jump/fall/inVehicle`, plus
  `aim`/`dead` for later tasks). Falling below y = -30 respawns.
- **Camera** (`game/camera/followCamera.ts`): `FollowCameraSystems()` reads mouse
  look into the `CameraRig` component (preSim) and places the camera (camera
  phase) behind the interpolated target, sweeping a sphere against
  `WORLD_STATIC` so it never goes inside buildings or under the ground.
- **Contract for vehicles (T0020)**: pressing F next to an entity with `Vehicle` +
  `Transform` sets `Driver { mode: 'player' }` on it, adds the player to
  `occupants`, emits `vehicleEntered`, hides the player and points
  `CameraRig.follow` at the car (the in-car camera preset can be changed on the
  rig). Pressing F again places the player beside the car (driver side first,
  then other sides if blocked), sets `Driver { mode: 'none' }` and emits
  `vehicleExited`.
- **Other interactions**: give an entity `Interactable { kind, prompt, radius }`
  and listen for the `interact` event. The nearest target and its prompt text
  are on `Character.focus` / `Character.prompt` for the HUD (T0023).

## Frame order

Fixed 60 Hz simulation (max 5 sub-steps per frame), then one render per animation
frame with interpolation:

`input → preSim → physics → postSim → ai → gameplay → events.flush()`, then
`camera → render (view sync) → ui → renderer.render()`.

## Debugging

- F3 overlay: fps, draw calls, triangles, physics bodies, entities, game time.
- `window.__neon`: read-only boot status (all builds; used by the smoke test).
- `window.__game`: full `{ services, world, loop }` handle in dev builds only.
