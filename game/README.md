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

You start **on foot** in the procedural city, on a central arterial right next to
the driver door of a parked sports car, facing north (-Z) towards the first
checkpoint. Walk up to the car and press **F** to get in; press **F** again to get
out. Drive through the yellow checkpoints for a timed warm-up lap.

On foot (T0021/T0026):

| Input             | Action                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| WASD / arrow keys | Move (relative to the camera)                                            |
| Shift             | Sprint                                                                   |
| Space             | Jump                                                                     |
| F                 | Enter the nearest vehicle, or use the nearest interactable object        |
| Click the game    | Capture the mouse for mouse look (Esc releases it). Dragging also works. |
| Mouse wheel       | Camera distance                                                          |
| F3                | Debug overlay                                                            |

In a car (T0020):

| Key                 | Action                                                   |
| ------------------- | -------------------------------------------------------- |
| W / Up              | Throttle                                                 |
| S / Down            | Brake; hold it at a standstill to reverse (max ~30 km/h) |
| A / D, Left / Right | Steer                                                    |
| Space               | Handbrake (locks the rear and lets the tail slide)       |
| R                   | Put the car back on its wheels (when nearly stopped)     |
| F                   | Get out (on the driver's side if it is clear)            |
| Mouse drag / wheel  | Look around the car / zoom (recenters after 1.5 s)       |

The on-foot test playground from T0021 (stairs, a ramp, a too-steep slope, a ledge,
a low roof, crates) lives in the old demo scene, which is no longer booted; the
character unit tests still use it. In the city you can step up kerbs onto the
sidewalks and walk along the buildings.

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
| `npm run city:export`             | Export the procedural city as a `.glb` and run the Khronos glTF validator (`-- --seed N --grid N --spacing M --drop P --out file.glb`; default `out/city-1986.glb`, git-ignored)                      |

## Layout

```
game/
  index.html  package.json  tsconfig.json  vite.config.ts  eslint.config.js  playwright.config.ts
  assets/            source assets for the generators (not served)
  public/            served as-is: favicon, THIRD_PARTY_NOTICES.txt
    assets/          generated .glb/.ktx2 + manifest.json (T0018)
  tools/             build-time asset generators (T0018); export-city.mjs (T0027)
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
    ui/              DOM overlay: HUD (speedometer, minimap, mission panel), debug overlay, fatal screen
    hudBridge.ts     builds the HudModel snapshot from the world each frame (joins game/ and ui/)
    game/
      components.ts  ALL shared component types
      events.ts      ALL event types
      shared/        physics step/sync, view sync, time-of-day systems
      camera/        follow camera on foot (spring arm + collision, T0021/T0026); chase camera in cars (T0020); debug orbit camera
      player/        on-foot controller, jump, interaction, enter/exit vehicle, mannequin view (T0021/T0026)
      vehicles/      VehicleDef data, DriveController, spawn, drive/collision/damage systems, car view (T0020);
                     the standalone Vehicle class and the test arena (T0025)
      demo/          the skeleton scene + on-foot playground (no longer booted; kept for its tests)
      missions/      checkpoint run (warm-up lap) feeding the HUD mission panel (T0023)
      wanted/        wanted level from crashes (T0028)
      world/         procedural city: CityData, RoadGraph, meshes, colliders, minimap, glTF export (T0027)
      ai/ combat/ save/   (owned by later tasks)
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

## HUD (T0023)

Plain DOM + CSS over the canvas, plus a 2D `<canvas>` minimap (T0016 §3.8). The HUD
never imports `game/`: `src/hudBridge.ts` fills a `HudModel` snapshot once per render
frame and `Hud.update(model, dt)` draws it.

- **Speedometer** (bottom right, only in a car): speed in km/h, gear, rev bar, damage bar.
- **Minimap** (bottom left): player-centred and heading-up (your direction of travel is
  always up; the **N** marker rides the rim). It zooms out with speed. The static map
  (roads, buildings, beach, sea) is drawn once into an off-screen canvas from the
  `MinimapMap` layout the world provides (`cityMinimap(city)`: RoadGraph edges, alleys,
  parks, beach and building footprints), so a frame is one
  `drawImage` plus the blips. The objective blip sticks to the rim when it is off the map.
  Entities with a `Blip` component also appear on it.
- **Mission panel** (top right; under the debug overlay on narrow windows): title, step
  `n/N`, timer, objective text and distance to the objective. It flashes when the
  objective changes, and a centred banner shows the result. Text nodes are only written
  when their string changes, numbers use tabular figures (no jitter), and the HUD layer
  has `pointer-events: none` so mouse look still works.
- The mission source for now is `game/missions` `CheckpointRun` (the **warm-up lap**:
  6 checkpoints, clock starts when you move, best time kept, restarts after 5 s). It
  writes a `MissionStatus` component and emits `missionStarted`, `missionStep` and
  `missionPassed`. The mission-system task replaces it with data-driven missions using
  the same component.

`window.__neon.hud` exposes what the HUD shows (speed text, mission, objective, minimap
centre) for tests. `tests/e2e/hud.spec.ts` checks in Chromium that speed and minimap
follow the car, the mission step advances at the first checkpoint, and that no two HUD
elements overlap or leave the screen from 1920x1080 down to 800x500.

## Procedural city (T0027)

`src/game/world/` builds the city at boot from a seed (default 1986). It is pure data first,
then meshes and colliders:

- **`generateCity(options) -> CityData`** (no Three.js, no Rapier; deterministic per seed).
  An 8 x 8 grid of irregularly spaced road lines: the outer ring and every third line are
  16 m arterials (4 lanes, double yellow line), the rest 11 m streets (2 lanes). Streets
  that are not needed to keep the network connected become 5 m alleys with probability
  `dropChance`; the `RoadGraph` is always connected (tested). Junctions, road corridors,
  alleys, raised walkways and blocks, plus open land and an east beach, are rectangles
  that **tile the land exactly** (no overlaps, no gaps). Blocks are raised 0.15 m with
  kerbs and have a 3 m sidewalk ring. Lots get buildings by district (downtown, beach,
  residential, industrial) in the T0018 §2.1 styles (`downtown_tower`, `downtown_office`,
  `beach_hotel`, `beach_shop`, `res_house`, `res_lowrise`, `ind_warehouse`): floors,
  podium and setback tiers, flat, hip or gable roofs. The default city has 326 buildings
  in 7 chunks of 256 m. `CityData` also carries spawn points, zones and the warm-up lap
  (junctions on arterials).
- **Naming (T0018 §8):** chunks `c_<x>_<z>`, buildings `b_<chunkX>_<chunkZ>_<index>`
  (numbered from 0 per chunk), materials `mat_asphalt`, `mat_sidewalk`, `mat_kerb`,
  `mat_grass`, `mat_sand`, `mat_water`, `mat_roof`, `mat_facade_<style>`; mesh parts are
  plain lowercase (`road`, `sidewalk`, `kerb`, `facade_beach_hotel`, ...). `CITY_NAMES`
  holds the regular expressions and the tests enforce them.
- **`buildCityMesh`** (runtime): one merged mesh per material per chunk (about 45 meshes,
  about 90k triangles for the default city). Lane markings are cut into the road surface
  and window rows into the walls (vertex colours), so no face is drawn on top of another.
  Facade meshes keep a `buildingId -> index range` table in `userData.buildings`.
- **`cityColliderDescs` / `createCityColliders`**: a ground slab, a 0.15 m box per raised
  block or walkway (kerbs are real steps), one body per building with a box per tier, and
  invisible walls at the shore.
- **`exportCityGlb(city)`** / **`npm run city:export`**: the same geometry with one mesh
  node per building (materials `mat_facade_<style>` + `mat_roof`, `extras` = style,
  district, floors, height) as binary glTF 2.0, validated by the Khronos glTF validator
  (0 errors, 0 warnings). meshopt compression is not applied yet (T0018's
  `tools/assets/lib/optimize.ts` does not exist yet); the default city is about 7.5 MB
  uncompressed.
- **`loadCity(services, city)`** adds the meshes and colliders and reports timings;
  `main.ts` spawns the cars from `city.spawnPoints`, feeds `city.lap` to the warm-up lap
  and `cityMinimap(city)` to the HUD. `window.__neon.city` shows the seed, counts and
  load time.

Tests: `tests/unit/city.test.ts` (layout, tiling, no overlapping faces, naming,
colliders, load time, glTF validation and reload), `tests/unit/cityNavigation.test.ts`
(a Rapier car drives the whole warm-up lap and 20 side-street runs with 0 collisions; a
Rapier character controller with T0026's settings climbs kerbs and is stopped by walls;
a flood fill proves every road and sidewalk is reachable on foot), and
`tests/e2e/city.spec.ts` (loads within 5 s in Chromium, no console errors).

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
