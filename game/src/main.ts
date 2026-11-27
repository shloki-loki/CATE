/**
 * Boot only (T0016 §4.1): check the browser, build services, create the world,
 * start the loop. No game logic lives here.
 */
import { AssetRegistry } from './assets';
import { NullAudio } from './audio';
import { createClock, EventBus, GameLoop, log, Settings, TimeOfDay, World } from './core';
import {
  Character,
  createDemoScene,
  createPlayer,
  FollowCameraSystems,
  PhysicsStepSystem,
  PlayerSystems,
  PhysicsSyncSystem,
  TimeOfDaySystem,
  Transform,
  ViewSyncSystem,
} from './game';
import type { GameEvents } from './game';
import { DEFAULT_BINDINGS, KeyboardMouseInput } from './input';
import { RapierPhysics } from './physics';
import { hasWebGL2, ThreeRenderer } from './render';
import type { Services } from './services';
import { DebugOverlay, showFatal } from './ui';
import './style.css';

/** Read-only status for the smoke test and for humans in DevTools (all builds). */
export interface BootStatus {
  phase: 'booting' | 'running' | 'failed';
  frames: number;
  ticks: number;
  drawCalls: number;
  triangles: number;
  bodies: number;
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
  world.addSystem(TimeOfDaySystem);
  // Camera control before player control (both preSim): movement uses this tick's camera yaw.
  for (const sys of FollowCameraSystems()) world.addSystem(sys);
  for (const sys of PlayerSystems()) world.addSystem(sys);
  world.addSystem(ViewSyncSystem);
  await world.init(services);

  const scene = createDemoScene(world, services);
  log.info(`demo scene: ${scene.buildings} buildings, ${scene.dynamic.length} dynamic bodies`);
  const player = createPlayer(world, services, scene.playerSpawn, scene.playerYaw);
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
