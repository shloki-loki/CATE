import { Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Character,
  CameraRig,
  CameraTarget,
  createPlayer,
  Driver,
  FollowCameraSystems,
  Interactable,
  makeTransform,
  PhysicsStepSystem,
  PhysicsSyncSystem,
  PlayerSystems,
  PrevTransform,
  RigidBody,
  Transform,
  spawnVehicle,
  Vehicle,
  View,
  ViewSyncSystem,
} from '../../src/game';
import { MOTOR } from '../../src/game/player';
import { CollisionGroup, type RapierPhysics } from '../../src/physics';
import type { GameWorld, Services } from '../../src/services';
import { makeServices, newWorld, type ScriptedInput } from './harness';

const DT = 1 / 60;
const FEET = 0.9; // capsule centre height above the feet

/** Static box with its top at `top` (or centred at y if top undefined). */
function box(
  p: RapierPhysics,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  rot?: Quaternion,
) {
  return p.createBody({
    type: 'static',
    position: { x, y, z },
    shapes: [{ kind: 'box', halfExtents: { x: hx, y: hy, z: hz } }],
    group: CollisionGroup.WORLD_STATIC,
    ...(rot ? { rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w } } : {}),
  });
}

describe('character controller (headless: ECS + Rapier KinematicCharacterController)', () => {
  let s: Services;
  let physics: RapierPhysics;
  let input: ScriptedInput;
  let world: GameWorld;

  beforeEach(async () => {
    ({ s, physics, input } = await makeServices());
    world = newWorld();
    for (const sys of FollowCameraSystems()) world.addSystem(sys);
    for (const sys of PlayerSystems()) world.addSystem(sys);
    world.addSystem(PhysicsStepSystem);
    world.addSystem(PhysicsSyncSystem);
    world.addSystem(ViewSyncSystem);
    await world.init(s);
    // Ground: 200 x 200, top at y = 0.
    box(physics, 0, -0.5, 0, 100, 0.5, 100);
  });

  const run = (seconds: number, each?: (tick: number) => void): void => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      each?.(i);
      input.poll();
      world.runSim(s, DT);
      s.events.flush();
      s.clock.alpha = 1;
      world.runFrame(s, DT);
    }
  };
  const pos = (e: number): Vector3 => world.require(e, Transform).position;

  it('spawns, falls onto the ground and stands still on it', () => {
    const p = createPlayer(world, s, { x: 0, y: 3, z: 0 });
    run(1.5);
    const c = world.require(p, Character);
    expect(c.grounded).toBe(true);
    expect(c.state).toBe('idle');
    expect(pos(p).y).toBeGreaterThan(FEET - 0.05);
    expect(pos(p).y).toBeLessThan(FEET + 0.1);
    const y = pos(p).y;
    run(1);
    expect(Math.abs(pos(p).y - y)).toBeLessThan(1e-3); // no jitter or sinking at rest
  });

  it('accelerates smoothly to jog and sprint speed, camera-relative, and stops quickly', () => {
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    run(0.3);
    input.axes.moveY = 1; // forward = -Z for camera yaw 0
    const speeds: number[] = [];
    let last = pos(p).clone();
    run(1.0, () => {
      const now = pos(p);
      speeds.push(now.distanceTo(last) / DT);
      last = now.clone();
    });
    const c = world.require(p, Character);
    expect(pos(p).z).toBeLessThan(-3);
    expect(Math.abs(pos(p).x)).toBeLessThan(0.01);
    expect(Math.hypot(c.velocity.x, c.velocity.z)).toBeCloseTo(MOTOR.runSpeed, 1);
    expect(c.state).toBe('run');
    // Smooth: speed never jumps by more than the acceleration allows in one tick (plus slack).
    for (let i = 2; i < speeds.length; i++)
      expect(Math.abs(speeds[i]! - speeds[i - 1]!)).toBeLessThan(MOTOR.groundAccel * DT + 0.05);
    // Faces the direction of travel.
    expect(Math.abs(c.facing)).toBeLessThan(0.01);

    input.held.add('sprint');
    run(1);
    expect(Math.hypot(c.velocity.x, c.velocity.z)).toBeCloseTo(MOTOR.sprintSpeed, 1);
    expect(c.state).toBe('sprint');

    input.held.clear();
    input.axes = {};
    run(0.4);
    expect(Math.hypot(c.velocity.x, c.velocity.z)).toBeLessThan(0.01);
    expect(c.state).toBe('idle');

    // Turn the camera 90° left (yaw +π/2): "forward" is now -X and the body turns to face it.
    world.require(p, CameraRig).yaw = Math.PI / 2;
    const x0 = pos(p).x;
    input.axes.moveY = 1;
    run(1);
    expect(pos(p).x).toBeLessThan(x0 - 3);
    expect(c.facing).toBeCloseTo(Math.PI / 2, 2);
  });

  it('is stopped by walls and slides along them instead of sticking', () => {
    // Wall across the path at z = -5 (front face at z = -4.5).
    box(physics, 0, 2, -5, 10, 2, 0.5);
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    input.axes.moveY = 1;
    run(3);
    expect(pos(p).z).toBeGreaterThan(-4.5 + 0.34); // capsule radius 0.35 stays outside the wall
    expect(pos(p).z).toBeLessThan(-4.0); // but reached it

    // Walk diagonally into the wall: blocked in z, keeps sliding in x.
    input.axes.moveX = 1;
    const x0 = pos(p).x;
    run(1);
    expect(pos(p).x).toBeGreaterThan(x0 + 1.5);
    expect(pos(p).z).toBeGreaterThan(-4.5 + 0.34);
  });

  it('cannot pass through a tall building even when sprinting at it for a long time', () => {
    box(physics, 0, 20, -12, 6, 20, 6); // 12 m wide, 40 m tall block, front face at z = -6
    const p = createPlayer(world, s, { x: 0.3, y: FEET + 0.05, z: 0 }, 0);
    input.axes.moveY = 1;
    input.held.add('sprint');
    run(5);
    expect(pos(p).z).toBeGreaterThan(-6 + 0.34);
    expect(pos(p).y).toBeLessThan(FEET + 0.1); // did not climb it
  });

  it('climbs curbs and stairs automatically but not a waist-high wall', () => {
    // Curb 0.2 m, then a flight of 0.25 m steps up to a 1.5 m platform, all along -Z.
    box(physics, 0, 0.1, -4, 3, 0.1, 1);
    for (let i = 0; i < 5; i++) {
      const top = 0.2 + (i + 1) * 0.25; // 0.45, 0.70, ... 1.45
      box(physics, 0, top / 2, -5.25 - i * 0.5, 3, top / 2, 0.25);
    }
    box(physics, 0, 0.75, -15, 3, 0.75, 7.5); // platform top at 1.5, z -7.5 .. -22.5
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    input.axes.moveY = 1;
    let maxStepUp = 0;
    let lastY = pos(p).y;
    run(3.5, () => {
      maxStepUp = Math.max(maxStepUp, pos(p).y - lastY);
      lastY = pos(p).y;
    });
    expect(pos(p).z).toBeLessThan(-10);
    expect(pos(p).y).toBeGreaterThan(1.5 + FEET - 0.05);
    expect(world.require(p, Character).grounded).toBe(true);
    expect(maxStepUp).toBeLessThan(0.46); // each step is climbed in one move, no teleports

    // A 1 m wall is too high to step: blocked unless jumping.
    const p2Start = { x: 20, y: FEET + 0.05, z: 0 };
    box(physics, 20, 0.5, -4, 3, 0.5, 0.5);
    const p2 = createPlayer(world, s, p2Start, 0);
    world.remove(p, CameraRig);
    run(2);
    expect(pos(p2).z).toBeGreaterThan(-3.5 + 0.34);
    expect(pos(p2).y).toBeLessThan(FEET + 0.1);
  });

  it('jumps (once per press, with the right height), lands, and can jump onto a 1 m ledge', () => {
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    run(0.5);
    const landed: number[] = [];
    s.events.on('landed', (e) => landed.push(e.speed));
    let apex = 0;
    input.tap('jump');
    run(1.2, () => (apex = Math.max(apex, pos(p).y)));
    const c = world.require(p, Character);
    expect(apex - FEET).toBeGreaterThan(MOTOR.jumpHeight - 0.1);
    expect(apex - FEET).toBeLessThan(MOTOR.jumpHeight + 0.1);
    expect(c.grounded).toBe(true);
    expect(landed.length).toBe(1);

    // Holding jump does not bunny-hop: one press, one jump.
    input.tap('jump');
    let takeoffs = 0;
    let wasGrounded = true;
    run(2, () => {
      input.held.add('jump');
      if (wasGrounded && !c.grounded) takeoffs++;
      wasGrounded = c.grounded;
    });
    input.held.clear();
    expect(takeoffs).toBe(1);

    // Run and jump onto a 1 m ledge (blocked without jumping, see the stairs test).
    box(physics, 0, 0.5, -10, 3, 0.5, 6); // top at 1.0, near face z = -4, 12 m deep
    input.axes.moveY = 1;
    let jumped = false;
    run(1.5, () => {
      if (!jumped && pos(p).z < -2.5) {
        input.tap('jump');
        jumped = true;
      }
    });
    expect(pos(p).z).toBeLessThan(-5);
    expect(pos(p).y).toBeGreaterThan(1 + FEET - 0.05);
    expect(c.grounded).toBe(true);
  });

  it('stops rising when it hits a ceiling', () => {
    box(physics, 0, 2.5, 0, 3, 0.25, 3); // ceiling underside at 2.25
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    run(0.5);
    let apex = 0;
    input.tap('jump');
    run(1.2, () => (apex = Math.max(apex, pos(p).y)));
    expect(apex + FEET).toBeLessThanOrEqual(2.25 + 0.05); // head never enters the ceiling
    expect(world.require(p, Character).grounded).toBe(true);
  });

  it('walks up a gentle ramp but slides back down a steep one', () => {
    const gentle = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (20 * Math.PI) / 180);
    box(physics, 0, 0, -8, 2, 0.2, 6, gentle); // rises toward -Z
    // Its surface meets the ground at z ≈ -7.4 and is 2.27 m high at z ≈ -13.6.
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    input.axes.moveY = 1;
    let top = 0;
    run(3.5, () => (top = Math.max(top, pos(p).y)));
    expect(top).toBeGreaterThan(FEET + 1.8);

    const steep = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (65 * Math.PI) / 180);
    box(physics, 30, 0, -6, 2, 0.2, 5, steep);
    const p2 = createPlayer(world, s, { x: 30, y: FEET + 0.05, z: 0 }, 0);
    world.remove(p, CameraRig);
    world.require(p, Character).state = 'dead'; // park the first player
    run(3);
    expect(pos(p2).y).toBeLessThan(FEET + 1.0);
  });

  it('pushes dynamic crates out of the way', () => {
    const e = world.createEntity();
    const h = physics.createBody({
      type: 'dynamic',
      position: { x: 0, y: 0.5, z: -3 },
      shapes: [{ kind: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }],
      group: CollisionGroup.PROP,
      density: 0.3,
      friction: 0.5,
    });
    const t = makeTransform(0, 0.5, -3);
    world.add(e, Transform, t);
    world.add(e, PrevTransform, makeTransform(0, 0.5, -3));
    world.add(e, RigidBody, { handle: h });
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    input.axes.moveY = 1;
    run(3);
    expect(t.position.z).toBeLessThan(-4); // the crate moved
    expect(pos(p).z).toBeLessThan(-3); // and the player got past where it was
  });

  it('respawns if it falls out of the world', () => {
    const p = createPlayer(world, s, { x: 150, y: 2, z: 0 }, 0); // off the 200 m ground
    world.require(p, Character).spawn.set(0, FEET + 0.05, 0);
    run(3);
    expect(Math.abs(pos(p).x)).toBeLessThan(0.5);
    expect(pos(p).y).toBeGreaterThan(0);
  });

  it('enters and exits a real vehicle with F, and the camera rig follows the vehicle meanwhile', () => {
    // A T0020 sedan 3 m ahead, facing the player (+Z forward, +X = its left = driver side).
    const car = spawnVehicle(world, s, 'sedan', 0, 0, -3, { yaw: 0, headless: true });
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    const entered: number[] = [];
    const exited: number[] = [];
    s.events.on('vehicleEntered', (e) => entered.push(e.vehicle));
    s.events.on('vehicleExited', (e) => exited.push(e.vehicle));
    run(0.5);
    const c = world.require(p, Character);
    expect(c.focus).toBe(car);
    expect(c.prompt).toMatch(/enter vehicle/);
    expect(world.require(car, Driver).mode).toBe('none');
    expect(world.has(car, CameraTarget)).toBe(false);

    input.tap('enterExit');
    run(0.2);
    expect(c.state).toBe('inVehicle');
    expect(entered).toEqual([car]);
    expect(world.require(car, Vehicle).occupants).toEqual([p]);
    expect(world.require(car, Driver).mode).toBe('player');
    expect(world.require(car, CameraTarget).preset).toBe('vehicle'); // chase camera takes over
    expect(world.require(p, CameraRig).follow).toBe(car);
    expect(world.require(p, View).object3D.visible).toBe(false);
    run(0.5);
    expect(pos(p).distanceTo(pos(car))).toBeLessThan(0.5); // rides along

    input.tap('enterExit');
    run(1);
    expect(c.state).not.toBe('inVehicle');
    expect(exited).toEqual([car]);
    expect(world.require(car, Vehicle).occupants).toEqual([]);
    expect(world.require(car, Driver).mode).toBe('none');
    expect(world.has(car, CameraTarget)).toBe(false);
    expect(world.require(p, CameraRig).follow).toBeNull();
    expect(world.require(p, View).object3D.visible).toBe(true);
    expect(c.grounded).toBe(true);
    const d = Math.hypot(pos(p).x - pos(car).x, pos(p).z - pos(car).z);
    expect(d).toBeGreaterThan(1.2); // standing beside the car, not inside it
    expect(d).toBeLessThan(3);
    expect(pos(p).x - pos(car).x).toBeGreaterThan(1.2); // on the driver's side (car's +X)
    // Facing the way the car faces (+Z), i.e. yaw π in the character convention.
    expect(Math.abs(Math.abs(c.facing) - Math.PI)).toBeLessThan(0.05);
  });

  it('exits on the passenger side when the driver side is against a wall', () => {
    box(physics, 2.2, 2, -3, 0.5, 2, 4); // wall about 0.75 m from the driver-side door
    const car = spawnVehicle(world, s, 'sedan', 0, 0, -3, { yaw: 0, headless: true });
    const p = createPlayer(world, s, { x: -0.5, y: FEET + 0.05, z: 0 }, 0);
    run(0.3);
    input.tap('enterExit');
    run(0.2);
    expect(world.require(p, Character).vehicle).toBe(car);
    input.tap('enterExit');
    run(1);
    expect(pos(p).x - pos(car).x).toBeLessThan(-1.2);
    expect(world.require(p, Character).grounded).toBe(true);
  });

  it('does not exit into another parked car', () => {
    const car = spawnVehicle(world, s, 'sedan', 0, 0, -3, { yaw: 0, headless: true });
    // A van parked right alongside the driver side.
    spawnVehicle(world, s, 'van', 2.3, 0, -3, { yaw: 0, headless: true });
    const p = createPlayer(world, s, { x: -0.5, y: FEET + 0.05, z: 0 }, 0);
    run(0.3);
    input.tap('enterExit');
    run(0.2);
    expect(world.require(p, Character).vehicle).toBe(car);
    input.tap('enterExit');
    run(1);
    expect(pos(p).x - pos(car).x).toBeLessThan(-1.2); // passenger side instead
  });

  it('emits interact for other Interactables in reach', () => {
    const sign = world.createEntity();
    world.add(sign, Transform, makeTransform(0, 1, -1.5));
    world.add(sign, Interactable, { kind: 'payphone', prompt: 'use payphone', radius: 2 });
    const p = createPlayer(world, s, { x: 0, y: FEET + 0.05, z: 0 }, 0);
    const got: string[] = [];
    s.events.on('interact', (e) => {
      expect(e.entity).toBe(p);
      got.push(e.kind);
    });
    run(0.3);
    expect(world.require(p, Character).prompt).toBe('F: use payphone');
    input.tap('enterExit');
    run(0.1);
    expect(got).toEqual(['payphone']);
  });
});
