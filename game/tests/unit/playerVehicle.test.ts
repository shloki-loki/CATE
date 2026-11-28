import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CameraTarget,
  Character,
  ChaseCameraSystem,
  CheckpointRunSystem,
  createPlayer,
  Driver,
  FollowCameraSystems,
  MissionStatus,
  PhysicsStepSystem,
  PhysicsSyncSystem,
  PlayerSystems,
  spawnVehicle,
  Transform,
  Vehicle,
  VehicleSystems,
  VehicleTelemetry,
  ViewSyncSystem,
} from '../../src/game';
import { MOTOR } from '../../src/game/player';
import { CollisionGroup, type RapierPhysics } from '../../src/physics';
import type { GameWorld, Services } from '../../src/services';
import { makeServices, newWorld, type RecordingRender, type ScriptedInput } from './harness';

/**
 * T0026: the character controller and the T0020 vehicle module running together with the
 * same systems, in the same order, as main.ts: walk on flat ground, get blocked by a parked
 * car, get in, drive (chase camera), get out (follow camera takes the view back without a
 * jump), and the car is left parked.
 */
const DT = 1 / 60;
const FEET = 0.9;

describe('player + vehicles + cameras (headless, main.ts system order)', () => {
  let s: Services;
  let physics: RapierPhysics;
  let input: ScriptedInput;
  let render: RecordingRender;
  let world: GameWorld;
  const camTrace: Vector3[] = [];

  beforeEach(async () => {
    ({ s, physics, input, render } = await makeServices());
    world = newWorld();
    const inputPoll = { name: 'inputPoll', phase: 'input' as const, update: () => input.poll() };
    world.addSystem(inputPoll);
    world.addSystem(PhysicsStepSystem);
    world.addSystem(PhysicsSyncSystem);
    for (const sys of VehicleSystems()) world.addSystem(sys);
    // The warm-up lap as main.ts adds it (before the cameras), here straight up -Z.
    world.addSystem(
      CheckpointRunSystem({
        id: 'lap',
        title: 'LAP',
        checkpoints: [
          { x: -3, z: -60 },
          { x: -3, z: -120 },
        ],
        radius: 9,
        restartDelay: 5,
      }),
    );
    for (const sys of FollowCameraSystems()) world.addSystem(sys);
    for (const sys of ChaseCameraSystem()) world.addSystem(sys);
    for (const sys of PlayerSystems()) world.addSystem(sys);
    world.addSystem(ViewSyncSystem);
    await world.init(s);
    physics.createBody({
      type: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      shapes: [{ kind: 'box', halfExtents: { x: 200, y: 0.5, z: 200 } }],
      group: CollisionGroup.WORLD_STATIC,
      friction: 0.9,
    });
    camTrace.length = 0;
  });

  /** Like main.ts: fixed sim ticks, then one rendered frame per tick (camera phase). */
  const run = (seconds: number): void => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      world.runSim(s, DT);
      s.events.flush();
      s.clock.tick++;
      s.clock.alpha = 1;
      world.runFrame(s, DT);
      camTrace.push(render.camera.position.clone());
    }
  };
  const pos = (e: number): Vector3 => world.require(e, Transform).position;
  const cam = (): Vector3 => render.camera.position;
  const flat = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);
  const mission = () => {
    for (const e of world.query(MissionStatus)) return world.require(e, MissionStatus);
    throw new Error('no MissionStatus');
  };
  /** Largest camera move between two consecutive frames in the trace since index `from`. */
  const maxCamStep = (from: number): number => {
    let m = 0;
    for (let i = Math.max(1, from); i < camTrace.length; i++)
      m = Math.max(m, camTrace[i]!.distanceTo(camTrace[i - 1]!));
    return m;
  };

  it('walks on flat ground with the follow camera behind, then is stopped by a parked car', () => {
    // Same layout as main.ts: sports car facing -Z, player at its driver door facing -Z.
    const car = spawnVehicle(world, s, 'sports', -3, 0, 45, { yaw: Math.PI, headless: true });
    const p = createPlayer(world, s, { x: -5.2, y: FEET + 0.05, z: 45.5 }, 0);
    run(1);
    const c = world.require(p, Character);
    expect(c.grounded).toBe(true);
    expect(c.state).toBe('idle');
    expect(c.focus).toBe(car);
    // Follow camera owns the view on foot: behind (+Z) and a few metres away.
    expect(cam().z).toBeGreaterThan(pos(p).z + 2);
    expect(cam().distanceTo(pos(p))).toBeLessThan(7);

    // W: walk forward (-Z) along the car's side on flat ground.
    const z0 = pos(p).z;
    const y0 = pos(p).y;
    input.axes.moveY = 1;
    const traceFrom = camTrace.length;
    run(2);
    input.axes.moveY = 0;
    expect(pos(p).z).toBeLessThan(z0 - 7);
    expect(Math.abs(pos(p).x + 5.2)).toBeLessThan(0.05); // straight line
    expect(Math.abs(pos(p).y - y0)).toBeLessThan(0.02); // stays on the ground
    expect(cam().z).toBeGreaterThan(pos(p).z + 2); // camera kept up behind
    expect(maxCamStep(traceFrom)).toBeLessThan(MOTOR.runSpeed * DT * 2); // smooth, no jumps
    run(0.5);
    expect(c.state).toBe('idle');

    // Walk back next to the car and strafe right (+X) into its side for 2 s: blocked.
    const p2 = createPlayer(world, s, { x: -5.5, y: FEET + 0.05, z: 45 }, 0);
    world.destroyEntity(p); // keep one player entity
    run(0.5);
    const carX0 = pos(car).x;
    input.axes.moveX = 1;
    run(2);
    input.axes.moveX = 0;
    const halfWidth = 1.9 / 2; // sports car width
    expect(pos(p2).x).toBeLessThan(pos(car).x - halfWidth); // never inside the car
    expect(pos(p2).x).toBeGreaterThan(-5.5 + 0.5); // but it did walk up to it
    expect(Math.abs(pos(car).x - carX0)).toBeLessThan(0.3); // the parked car barely moves
  });

  it('gets in, drives with the chase camera, gets out on the driver side, and the car stays parked', () => {
    const car = spawnVehicle(world, s, 'sports', -3, 0, 45, { yaw: Math.PI, headless: true });
    const p = createPlayer(world, s, { x: -5.2, y: FEET + 0.05, z: 45.5 }, 0);
    run(1);
    const c = world.require(p, Character);

    input.tap('enterExit');
    run(0.1);
    expect(c.state).toBe('inVehicle');
    expect(world.require(car, Driver).mode).toBe('player');
    expect(world.require(car, CameraTarget).preset).toBe('vehicle');

    // Throttle (W): the car drives toward -Z, the player rides along, the chase camera trails it.
    input.axes.throttle = 1;
    input.axes.moveY = 1;
    run(4);
    input.axes.throttle = 0;
    input.axes.moveY = 0;
    const tel = world.require(car, VehicleTelemetry);
    expect(tel.speed * 3.6).toBeGreaterThan(40);
    expect(pos(car).z).toBeLessThan(45 - 20);
    expect(pos(p).distanceTo(pos(car))).toBeLessThan(0.6);
    expect(cam().z).toBeGreaterThan(pos(car).z + 3); // behind the car
    expect(cam().distanceTo(pos(car))).toBeLessThan(16);

    // Brake to a stop, then F: out on the driver side (car's +X = world -X at yaw π).
    input.axes.brake = 1;
    // Per tick: holding S at a standstill would start reversing.
    for (let i = 0; i < 600 && tel.speed > 0.3; i++) run(DT);
    input.axes.brake = 0;
    expect(Math.abs(tel.speed)).toBeLessThan(0.5);
    const lastInCar = camTrace.length - 1;
    input.tap('enterExit');
    run(1);
    expect(c.state).toBe('idle');
    expect(c.grounded).toBe(true);
    expect(world.require(car, Driver).mode).toBe('none');
    expect(world.has(car, CameraTarget)).toBe(false);
    expect(world.require(car, Vehicle).occupants).toEqual([]);
    expect(pos(p).x).toBeLessThan(pos(car).x - 1.2);
    expect(flat(pos(p), pos(car))).toBeLessThan(3);
    // Camera hand-over back to the follow camera: no cut, then it settles near the player.
    expect(maxCamStep(lastInCar)).toBeLessThan(0.6);
    run(2);
    expect(cam().distanceTo(pos(p))).toBeLessThan(10);
    expect(render.camera.fov).toBeCloseTo(60, 0);

    // On foot again: W moves the player, and the empty car no longer responds.
    const carZ = pos(car).z;
    const pz = pos(p).z;
    input.axes.throttle = 1;
    input.axes.moveY = 1;
    run(1.5);
    input.axes.throttle = 0;
    input.axes.moveY = 0;
    expect(Math.abs(pos(car).z - carZ)).toBeLessThan(0.2);
    expect(flat(pos(p), new Vector3(pos(p).x, 0, pz))).toBeGreaterThan(3);
  });

  it('the lap clock stays at zero while the player waits, gets in and idles, and starts when the car drives away', () => {
    // main.ts layout: the character 2.2 m beside and 0.5 m behind the parked car's driver door.
    const car = spawnVehicle(world, s, 'sports', -3, 0, 45, { yaw: Math.PI, headless: true });
    const p = createPlayer(world, s, { x: -5.2, y: FEET + 0.05, z: 45.5 }, 0);
    run(2); // waiting on foot
    expect(mission().elapsed).toBe(0);
    expect(mission().objective).toMatch(/Get in a car/);
    expect(mission().step).toBe(1);

    input.tap('enterExit');
    run(0.1);
    expect(world.require(p, Character).state).toBe('inVehicle');
    run(3); // idling in the parked car
    expect(Math.abs(world.require(car, VehicleTelemetry).speed)).toBeLessThan(0.1);
    expect(mission().elapsed).toBe(0);
    expect(mission().objective).toMatch(/start the lap/);

    input.axes.throttle = 1;
    input.axes.moveY = 1;
    run(3);
    expect(mission().elapsed).toBeGreaterThan(1);
    expect(mission().objective).not.toMatch(/start the lap/);
    // Keep driving: the car (not the character) reaches the first checkpoint.
    for (let i = 0; i < 600 && mission().step === 1; i++) run(DT * 10);
    input.axes.throttle = 0;
    input.axes.moveY = 0;
    expect(mission().step).toBe(2);
  });
});
