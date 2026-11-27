/**
 * Vehicle test arena (T0025): the standalone `Vehicle` class driven from a plain
 * fixed-timestep GameLoop, with no ECS. Open arena.html.
 *
 *   arena.html                 drive with the keyboard (W/S/A/D, Space, R)
 *   arena.html?autodrive       run the scripted 30-second test drive, then idle
 *   arena.html?car=sports      pick the class: compact, sedan, sports, van, police
 *
 * window.__arena exposes read-only status for the end-to-end test and DevTools.
 */
import { Vector3 } from 'three';
import { GameLoop, log } from './core';
import {
  ARENA_DRIVE_SECONDS,
  ARENA_START,
  arenaDrivePhase,
  arenaLayout,
  arenaView,
  createArenaPhysics,
  DrivableVehicle,
  VEHICLE_DEFS,
} from './game';
import { KeyboardMouseInput } from './input';
import { RapierPhysics } from './physics';
import { hasWebGL2, ThreeRenderer } from './render';
import { showFatal, Speedometer } from './ui';
import './style.css';

export interface ArenaStatus {
  phase: 'booting' | 'running' | 'failed';
  mode: 'manual' | 'autodrive';
  car: string;
  ticks: number;
  frames: number;
  /** Simulated seconds. */
  simTime: number;
  /** Current scripted phase (autodrive), or 'manual'. */
  step: string;
  /** True once the 30-second scripted drive has finished. */
  done: boolean;
  vehicle: { x: number; y: number; z: number; heading: number; speedKmh: number; gear: number; upY: number };
  maxKmh: number;
  minKmh: number;
  /** Accumulated heading change while steering right / left (rad; right is negative). */
  turnedRight: number;
  turnedLeft: number;
  minUpY: number;
  /** Largest distance between the drawn model and the segment between the last two physics positions (m). */
  maxSyncError: number;
  error: string | null;
}

declare global {
  interface Window {
    __arena: ArenaStatus;
  }
}

const params = new URLSearchParams(location.search);
const carId = params.get('car') ?? 'sedan';
const status: ArenaStatus = {
  phase: 'booting',
  mode: params.has('autodrive') ? 'autodrive' : 'manual',
  car: carId,
  ticks: 0,
  frames: 0,
  simTime: 0,
  step: 'manual',
  done: false,
  vehicle: { x: 0, y: 0, z: 0, heading: 0, speedKmh: 0, gear: 1, upY: 1 },
  maxKmh: 0,
  minKmh: 0,
  turnedRight: 0,
  turnedLeft: 0,
  minUpY: 1,
  maxSyncError: 0,
  error: null,
};
window.__arena = status;

function fail(title: string, err: unknown): void {
  status.phase = 'failed';
  status.error = err instanceof Error ? err.message : String(err);
  log.error(title, err);
  showFatal(document.getElementById('app') ?? document.body, title, status.error);
}
window.addEventListener('error', (e) => {
  const msg = String(e.error?.message ?? e.message);
  if (msg.startsWith('ResizeObserver loop')) return;
  status.error ??= msg;
});
window.addEventListener('unhandledrejection', (e) => {
  status.error ??= String(e.reason);
});

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!app || !canvas) throw new Error('arena.html is missing #app or #game');
  if (!hasWebGL2()) throw new Error('WebGL2 is not available in this browser');
  if (!(carId in VEHICLE_DEFS))
    throw new Error(`Unknown car "${carId}" (use ${Object.keys(VEHICLE_DEFS).join(', ')})`);

  const render = new ThreeRenderer();
  const physics = new RapierPhysics();
  await Promise.all([render.init(canvas), physics.init()]);
  render.setTimeOfDay(14);
  const input = new KeyboardMouseInput(canvas);

  const layout = arenaLayout();
  createArenaPhysics(physics, layout);
  render.addToWorld(arenaView(layout), 'static');

  const car = new DrivableVehicle(physics, carId, { position: ARENA_START, yaw: ARENA_START.yaw });
  if (car.object3D) render.addToWorld(car.object3D, 'dynamic');
  const speedo = new Speedometer(app);
  const redline = car.def.engine.redlineRpm;

  // Simple chase camera: behind and above the car, smoothed.
  const cam = render.camera;
  const camPos = new Vector3();
  const desired = new Vector3();
  const look = new Vector3();
  const fwd = new Vector3();
  const seg = new Vector3();
  const off = new Vector3();
  let lastHeading = car.heading;
  let camReady = false;

  const loop = new GameLoop({
    step(dt) {
      input.poll();
      if (status.mode === 'autodrive') {
        const ph = arenaDrivePhase(status.simTime);
        status.done = status.simTime >= ARENA_DRIVE_SECONDS;
        status.step = status.done ? 'done' : ph.label;
        car.setInput(status.done ? { throttle: 0, brake: 0, steer: 0, handbrake: true } : ph.input);
      } else {
        car.setInput({
          throttle: input.axis('throttle'),
          brake: input.axis('brake'),
          steer: input.axis('steer'),
          handbrake: input.down('handbrake'),
        });
        if (input.pressed('reset') && car.canReset) car.reset();
      }
      car.update(dt);
      physics.step(dt);
      car.postStep();
      status.simTime += dt;
      status.ticks++;

      const h = car.heading;
      const d = Math.atan2(Math.sin(h - lastHeading), Math.cos(h - lastHeading));
      lastHeading = h;
      if (car.input.steer > 0.5) status.turnedRight += d;
      else if (car.input.steer < -0.5) status.turnedLeft += d;
      status.maxKmh = Math.max(status.maxKmh, car.speedKmh);
      status.minKmh = Math.min(status.minKmh, car.speedKmh);
      status.minUpY = Math.min(status.minUpY, car.up().y);
    },
    render(alpha, frameDt) {
      car.syncView(alpha);
      // The drawn model must lie between the last two physics positions.
      if (car.object3D) {
        seg.subVectors(car.transform.position, car.prevTransform.position);
        off.subVectors(car.object3D.position, car.prevTransform.position);
        const l2 = seg.lengthSq();
        const along = l2 > 0 ? Math.min(1, Math.max(0, off.dot(seg) / l2)) : 0;
        const err = off.sub(seg.multiplyScalar(along)).length();
        status.maxSyncError = Math.max(status.maxSyncError, err);
      }
      const o = car.object3D;
      if (o) {
        fwd.set(0, 0, 1).applyQuaternion(o.quaternion).setY(0).normalize();
        desired
          .copy(o.position)
          .addScaledVector(fwd, -9)
          .setY(o.position.y + 3.6);
        if (!camReady) camPos.copy(desired);
        camPos.lerp(desired, camReady ? 1 - Math.exp(-6 * frameDt) : 1);
        camReady = true;
        cam.position.copy(camPos);
        look.copy(o.position).setY(o.position.y + 1);
        cam.lookAt(look);
      }
      render.render(alpha);
      status.frames++;
      const p = car.position;
      const v = status.vehicle;
      v.x = p.x;
      v.y = p.y;
      v.z = p.z;
      v.heading = car.heading;
      v.speedKmh = car.speedKmh;
      v.gear = car.gear;
      v.upY = car.up().y;
      speedo.update({
        speedKmh: car.speedKmh,
        gear: car.gear,
        rpm: car.rpm,
        redlineRpm: redline,
        health: car.health / car.maxHealth,
      });
    },
  });
  status.phase = 'running';
  log.info(`vehicle arena: ${carId}, ${status.mode}`);
  loop.start();
}

boot().catch((err: unknown) => fail('The vehicle arena failed to start', err));
