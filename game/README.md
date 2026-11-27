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

Controls (you start in a sports car on the avenue, facing the central crossing):

| Key                 | Action                                                   |
| ------------------- | -------------------------------------------------------- |
| W / Up              | Throttle                                                 |
| S / Down            | Brake; hold it at a standstill to reverse (max ~30 km/h) |
| A / D, Left / Right | Steer                                                    |
| Space               | Handbrake (locks the rear and lets the tail slide)       |
| R                   | Put the car back on its wheels (when nearly stopped)     |
| Mouse drag / wheel  | Look around the car / zoom (recenters after 1.5 s)       |
| F3                  | Toggle the debug overlay                                 |

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
    arena.ts         vehicle test arena page (arena.html, T0025)
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
      camera/        chase camera for vehicles (T0020); debug orbit camera (unused, kept for debugging)
      vehicles/      VehicleDef data, DriveController, spawn, drive/collision/damage systems, car view (T0020);
                     the standalone Vehicle class and the test arena (T0025)
      demo/          the skeleton scene (replaced by T0022's procedural city)
      world/ player/ ai/ combat/ wanted/ missions/ save/   (owned by later tasks)
  tests/
    unit/            Vitest
    e2e/             Playwright smoke test and arena drive test
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

## Vehicles (T0020)

Cars use Rapier's `DynamicRayCastVehicleController` (raycast suspension and tyre
friction) behind `PhysicsAPI.createVehicle / setVehicleControls / getVehicleState`.
All handling is data in `src/game/vehicles/defs.ts` (five classes: compact, sports,
sedan, van, police). `drive.ts` turns throttle/brake/steer/handbrake into per-wheel
forces: torque curve, automatic gearbox, rev limiter, engine braking, brake bias,
reverse on held brake, speed-sensitive and rate-limited steering with Ackermann
geometry, and a parking brake. The vehicle systems add air drag and rolling
resistance, turn Rapier contact-force events into `collision` events (with `b = null`
for static world geometry), and apply collision `damage` (a wrecked car loses drive
and emits `death`). The chassis uses continuous collision detection, so fast cars do
not tunnel through thin walls.

`tests/unit/vehicles.test.ts` checks headless at 60 Hz that 0-100 km/h times,
top speeds and 100-0 km/h braking distances are in realistic ranges for each class,
and that full-lock cornering at 100 km/h does not roll any class over.

To tune a car, edit its def and run `npm test`. The plausibility tests will flag
values that are out of range.

## The `Vehicle` class and the test arena (T0025)

`Vehicle` (`src/game/vehicles/Vehicle.ts`) is a whole car in one object: the Rapier
raycast vehicle (chassis body, four wheel rays with spring/damper suspension and
tyre friction), the drive controller above, drag and rolling resistance, and the
Three.js model with wheels that steer, spin and follow the suspension. It runs the
same physics and drive code as the ECS systems (shared in `driveTick.ts`; a unit
test checks that both follow the same path to within 1 mm), so it can be used with no ECS:

```ts
import { Vehicle } from './game/vehicles'; // from './game' it is `DrivableVehicle`

const car = new Vehicle(physics, 'sedan', { position: { x: 0, y: 0, z: 0 }, yaw: 0 });
car.addTo(scene); // any Three.js Scene/Group
new GameLoop({
  step(dt) {
    car.setInput({ throttle: 1, brake: 0, steer: 0.3, handbrake: false }); // steer -1 left .. +1 right
    car.update(dt); // before physics.step
    physics.step(dt);
    car.postStep(); // after physics.step
  },
  render(alpha) {
    car.syncView(alpha); // mesh interpolated between the last two ticks
    renderer.render(alpha);
  },
}).start();
```

It also has `speed`/`speedKmh`/`gear`/`rpm`/`heading`/`position`/`quaternion`, `forward()`/`up()`,
`telemetry`, `reset()`, `damage()`, `dispose()` and `view: false` for headless use.
(`Vehicle` from `./game` is still the ECS component, so the class is exported there as
`DrivableVehicle`.)

The **vehicle test arena** (`arena.html`, entry `src/arena.ts`) drives the class
from a plain `GameLoop`. It is a walled 240 m square with a ramp and kerbs:

- `npm run dev`, then open `http://localhost:5173/arena.html`: drive with W/S/A/D (or arrows), Space for the handbrake and R to reset.
- `arena.html?autodrive`: runs the scripted 30-second test drive (`ARENA_DRIVE_SCRIPT`):
  accelerate, turn right, brake, reverse, drive off, turn left, handbrake slide, stop.
- `arena.html?car=sports`: pick the class (compact, sedan, sports, van, police).
- `window.__arena`: read-only status (speeds, turns, sync error, errors) for tests and DevTools.

Tests: `tests/unit/vehicleClass.test.ts` (headless, every class) and `tests/e2e/arena.spec.ts`
(the real build in headless Chromium).
