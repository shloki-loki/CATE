/**
 * Boot only (T0016 §4.1): check the browser, build services, create the world,
 * start the loop. No game logic lives here.
 */
import { Vector3 } from 'three';
import { AssetRegistry } from './assets';
import { NullAudio } from './audio';
import { createClock, EventBus, GameLoop, log, Settings, TimeOfDay, World } from './core';
import {
  Character,
  ChaseCameraSystem,
  CheckpointRunSystem,
  cityMinimap,
  createPlayer,
  Driver,
  FollowCameraSystems,
  generateCity,
  loadCity,
  PhysicsStepSystem,
  PlayerSystems,
  PhysicsSyncSystem,
  PlayerHealthSystem,
  spawnVehicle,
  TimeOfDaySystem,
  Transform,
  Vehicle,
  VehicleSystems,
  ViewSyncSystem,
  WantedSystem,
  WARMUP_LAP,
} from './game';
import type { GameEvents } from './game';
import { DEFAULT_BINDINGS, KeyboardMouseInput } from './input';
import { RapierPhysics } from './physics';
import { hasWebGL2, ThreeRenderer } from './render';
import type { Services } from './services';
import { createHudReader } from './hudBridge';
import { DebugOverlay, Hud, showFatal } from './ui';
import './style.css';

/** Read-only status for the smoke test and for humans in DevTools (all builds). */
export interface BootStatus {
  phase: 'booting' | 'running' | 'failed';
  frames: number;
  ticks: number;
  drawCalls: number;
  triangles: number;
  bodies: number;
  /** The player's car (T0020), for the smoke test and DevTools. */
  vehicle: {
    x: number;
    y: number;
    z: number;
    heading: number;
    speedKmh: number;
    gear: number;
    health: number;
    upY: number;
  } | null;
  /** `collision` events seen since boot. */
  collisions: number;
  /** The procedural city (T0027): what was generated and how long loading it took. */
  city: {
    seed: number;
    buildings: number;
    roads: number;
    chunks: number;
    /** Generate + build meshes + create colliders, in milliseconds. */
    loadMs: number;
    /** From navigation start until the city was in the scene, in milliseconds. */
    readyAtMs: number;
    /** Where the sports car the player starts beside is parked (yaw: car heading, radians). */
    playerCar: { x: number; z: number; yaw: number };
  } | null;
  /** What the HUD shows (T0023), for the smoke test and DevTools. */
  hud: {
    speed: string | null;
    mission: string | null;
    objective: string | null;
    /** World position at the minimap's centre. */
    mapX: number | null;
    mapZ: number | null;
    /** Player health 0..100 and the wanted stars lit on screen (T0028). */
    health: number | null;
    wanted: number | null;
  };
  error: string | null;
  /** Player capsule centre and on-foot state (T0021). */
  player: { x: number; y: number; z: number; state: string; grounded: boolean } | null;
  camera: { x: number; y: number; z: number } | null;
}

declare global {
  interface Window {
    __neon: BootStatus;
    /** Full game handle, dev builds only (T0016 §3.10). */
    __game?: { services: Services; world: World<Services>; loop: GameLoop };
  }
}

const status: BootStatus = {
  phase: 'booting',
  frames: 0,
  ticks: 0,
  drawCalls: 0,
  triangles: 0,
  bodies: 0,
  vehicle: null,
  collisions: 0,
  city: null,
  hud: { speed: null, mission: null, objective: null, mapX: null, mapZ: null, health: null, wanted: null },
  error: null,
  player: null,
  camera: null,
};
window.__neon = status;

function fail(title: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  status.phase = 'failed';
  status.error = detail;
  log.error(title, err);
  showFatal(document.getElementById('app') ?? document.body, title, detail);
}

/** Errors before the loop runs replace the page with a message; later ones are recorded and logged. */
function onRuntimeError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  // Chrome reports this benign layout notice as an error event; it is not a game error.
  if (msg.startsWith('ResizeObserver loop')) return;
  if (status.phase === 'booting') return fail('Neon Coast failed to start', err);
  status.error ??= msg;
  log.error('Unexpected error', err);
}
window.addEventListener('error', (e) => onRuntimeError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => onRuntimeError(e.reason));

/**
 * Where the on-foot player starts: beside the driver door of the car at `car`, facing the
 * same way, so F gets straight in. T0020 cars drive along local +Z with +X as their left
 * (driver) side; a character's yaw 0 faces -Z (T0021).
 */
function besideDriverDoor(car: { x: number; z: number; yaw: number }): {
  x: number;
  y: number;
  z: number;
  yaw: number;
} {
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  const lx = Math.cos(car.yaw);
  const lz = -Math.sin(car.yaw);
  return {
    x: car.x + lx * 2.2 - fx * 0.5,
    y: 0.95,
    z: car.z + lz * 2.2 - fz * 0.5,
    yaw: Math.atan2(-fx, -fz),
  };
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!app || !canvas) throw new Error('index.html is missing #app or #game');

  if (!hasWebGL2()) {
    status.phase = 'failed';
    status.error = 'WebGL2 not available';
    showFatal(
      app,
      'WebGL2 is not available',
      'Neon Coast needs a browser with WebGL2 (current Chrome, Edge or Firefox) and hardware acceleration enabled.',
    );
    return;
  }

  const settings = new Settings();
  const render = new ThreeRenderer();
  const physics = new RapierPhysics();
  const assets = new AssetRegistry(import.meta.env.BASE_URL);
  await Promise.all([render.init(canvas), physics.init(), assets.init()]);
  render.setQuality(settings.values.quality);

  const services: Services = {
    physics,
    render,
    audio: new NullAudio(),
    input: new KeyboardMouseInput(canvas, DEFAULT_BINDINGS, true),
    assets,
    events: new EventBus<GameEvents>((type, err) => log.error(`event ${String(type)}`, err)),
    settings,
    time: new TimeOfDay(15, 1 / 60), // afternoon; sunset arrives after ~3 real minutes
    clock: createClock(),
  };
  settings.onChange((v) => render.setQuality(v.quality));

  const world = new World<Services>();
  const inputPoll = {
    name: 'inputPoll',
    phase: 'input' as const,
    update: (_w: unknown, s: Services) => s.input.poll(),
  };
  world.addSystem(inputPoll);
  world.addSystem(PhysicsStepSystem);
  world.addSystem(PhysicsSyncSystem);
  for (const sys of VehicleSystems()) world.addSystem(sys);
  world.addSystem(TimeOfDaySystem);
  // The city is pure data first (fast), so the warm-up lap can follow its arterials.
  const city = generateCity();
  world.addSystem(CheckpointRunSystem({ ...WARMUP_LAP, checkpoints: city.lap }));
  world.addSystem(WantedSystem());
  world.addSystem(PlayerHealthSystem());
  // Camera control before player control (both preSim): movement uses this tick's camera yaw.
  // On foot the follow camera drives the view; in a car the chase camera does (they hand over
  // through CameraTarget { preset: 'vehicle' }, which the player module sets on enter/exit).
  for (const sys of FollowCameraSystems()) world.addSystem(sys);
  for (const sys of ChaseCameraSystem()) world.addSystem(sys);
  for (const sys of PlayerSystems()) world.addSystem(sys);
  world.addSystem(ViewSyncSystem);
  await world.init(services);

  const loaded = loadCity(services, city);
  // The sports car on an arterial, facing north (-Z) towards the first checkpoint, with
  // parked cars at the kerbs. Nobody is in it: the player starts on foot by its driver door.
  let playerCar: { x: number; z: number; yaw: number } | null = null;
  for (const sp of city.spawnPoints) {
    spawnVehicle(world, services, sp.vehicle, sp.x, 0, sp.z, { yaw: sp.yaw });
    if (sp.kind === 'player') playerCar = { x: sp.x, z: sp.z, yaw: sp.yaw };
  }
  if (playerCar === null) throw new Error('city has no player spawn point');
  status.city = {
    seed: city.seed,
    buildings: city.buildings.length,
    roads: city.roads.edges.length,
    chunks: city.chunks.length,
    loadMs: Math.round(loaded.timings.total),
    readyAtMs: Math.round(performance.now()),
    playerCar,
  };
  const onFoot = besideDriverDoor(playerCar);
  const player = createPlayer(world, services, onFoot, onFoot.yaw);
  log.info(
    `city seed ${city.seed}: ${city.buildings.length} buildings, ${city.roads.edges.length} roads, ` +
      `${city.chunks.length} chunks, ${loaded.bodies.length} static bodies, loaded in ${Math.round(loaded.timings.total)} ms ` +
      `(generate ${Math.round(loaded.timings.generate)}, meshes ${Math.round(loaded.timings.mesh)}, colliders ${Math.round(loaded.timings.colliders)}); ` +
      `${physics.vehicleCount} vehicles (enter the sports car with F)`,
  );
  services.events.on('collision', () => status.collisions++);
  const hud = new Hud(app);
  hud.setMap(cityMinimap(city));
  const readHud = createHudReader(world);
  const up = new Vector3();
  /** The car the player character is driving, if any. */
  const playerVehicle = (): number | null => {
    const c = world.get(player, Character);
    const e = c?.state === 'inVehicle' ? c.vehicle : null;
    return e !== null && world.isAlive(e) && world.get(e, Driver)?.mode === 'player' ? e : null;
  };
  const updateHud = (frameDt: number): void => {
    const m = readHud();
    hud.update(m, frameDt);
    const e = playerVehicle();
    if (e === null || !m.vehicle || !m.player) {
      status.vehicle = null;
    } else {
      const t = world.require(e, Transform);
      up.set(0, 1, 0).applyQuaternion(t.quaternion);
      status.vehicle = {
        x: t.position.x,
        y: t.position.y,
        z: t.position.z,
        heading: m.player.heading,
        speedKmh: m.vehicle.speedKmh,
        gear: m.vehicle.gear,
        health: world.require(e, Vehicle).health,
        upY: up.y,
      };
    }
    status.hud.speed = m.vehicle ? String(Math.round(Math.abs(m.vehicle.speedKmh))) : null;
    status.hud.mission = m.mission?.title ?? null;
    status.hud.objective = m.mission?.objective ?? null;
    status.hud.mapX = m.player ? hud.minimap.centre.x : null;
    status.hud.mapZ = m.player ? hud.minimap.centre.z : null;
    status.hud.health = m.status ? Math.ceil(m.status.health * 100) : null;
    status.hud.wanted = m.status ? hud.status.wantedShown : null;
  };
  render.setTimeOfDay(services.time.hours);

  const overlay = new DebugOverlay(app, true);
  let fps = 60;

  const loop = new GameLoop({
    step(dt) {
      world.runSim(services, dt);
      services.events.flush();
      services.clock.tick++;
      services.clock.simTime += dt;
      if (services.input.pressed('debug')) overlay.toggle();
    },
    render(alpha, frameDt) {
      services.clock.alpha = alpha;
      world.runFrame(services, frameDt);
      render.render(alpha);
      services.clock.frame++;
      if (frameDt > 0) fps += (1 / frameDt - fps) * 0.05;
      const st = render.stats();
      status.frames = services.clock.frame;
      status.ticks = services.clock.tick;
      status.drawCalls = st.drawCalls;
      status.triangles = st.triangles;
      status.bodies = physics.bodyCount;
      updateHud(frameDt);
      const pt = world.get(player, Transform);
      const pc = world.get(player, Character);
      if (pt && pc) {
        const p = (status.player ??= { x: 0, y: 0, z: 0, state: '', grounded: false });
        p.x = pt.position.x;
        p.y = pt.position.y;
        p.z = pt.position.z;
        p.state = pc.state;
        p.grounded = pc.grounded;
      }
      const cp = render.camera.position;
      status.camera = { x: cp.x, y: cp.y, z: cp.z };
      overlay.update(frameDt, {
        fps,
        drawCalls: st.drawCalls,
        triangles: st.triangles,
        bodies: physics.bodyCount,
        entities: world.entityCount,
        timeOfDay: services.time.hours,
        quality: settings.values.quality,
      });
    },
  });

  if (import.meta.env.DEV) window.__game = { services, world, loop };
  status.phase = 'running';
  loop.start();
}

boot().catch((err: unknown) => fail('Neon Coast failed to start', err));
