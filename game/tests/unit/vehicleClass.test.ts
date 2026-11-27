import { Quaternion, Scene, Vector3, type Object3D } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GameLoop } from '../../src/core';
import {
  ARENA_DRIVE_SCRIPT,
  ARENA_DRIVE_SECONDS,
  ARENA_START,
  arenaDrivePhase,
  arenaLayout,
  arenaView,
  createArenaPhysics,
  DrivableVehicle,
  spawnVehicle,
  Transform,
  VEHICLE_DEFS,
  VehicleControl,
  Vehicle as VehicleComponent,
  VehicleTelemetry,
} from '../../src/game';
import { Vehicle } from '../../src/game/vehicles';
import { CollisionGroup, RapierPhysics } from '../../src/physics';
import { createHarness } from './vehicleHarness';

/**
 * T0025: the standalone `Vehicle` class (Rapier raycast vehicle + DriveController +
 * Three.js model) used directly from a game loop, without the ECS.
 * Real Rapier WASM in Node; the model is built but not drawn.
 */
const DT = 1 / 60;
const open: RapierPhysics[] = [];

async function physicsWithGround(): Promise<RapierPhysics> {
  const p = new RapierPhysics();
  await p.init();
  open.push(p);
  p.createBody({
    type: 'static',
    position: { x: 0, y: -0.5, z: 0 },
    shapes: [{ kind: 'box', halfExtents: { x: 6000, y: 0.5, z: 6000 } }],
    group: CollisionGroup.WORLD_STATIC,
    friction: 0.9,
  });
  return p;
}

/** One fixed tick the way a game loop does it. */
function tick(p: RapierPhysics, cars: Vehicle[]): void {
  for (const c of cars) c.update(DT);
  p.step(DT);
  for (const c of cars) c.postStep();
}

function run(p: RapierPhysics, car: Vehicle, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    tick(p, [car]);
    each?.();
  }
}

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

afterEach(() => {
  for (const p of open.splice(0)) p.dispose();
});

describe('Vehicle class: creation and scene', () => {
  it('is exported as Vehicle from game/vehicles and as DrivableVehicle from game/', () => {
    expect(DrivableVehicle).toBe(Vehicle);
    expect(typeof Vehicle).toBe('function');
    // The barrel's `Vehicle` is still the ECS component used by the systems.
    expect(VehicleComponent).not.toBe(Vehicle);
  });

  it('can be instantiated and added to a Three.js scene, for every vehicle class', async () => {
    const p = await physicsWithGround();
    const scene = new Scene();
    const cars = Object.keys(VEHICLE_DEFS).map((id, i) =>
      new Vehicle(p, id, { position: { x: i * 6, y: 0, z: 0 } }).addTo(scene),
    );
    expect(p.vehicleCount).toBe(cars.length);
    for (const car of cars) {
      expect(car.object3D).not.toBeNull();
      expect(scene.children).toContain(car.object3D);
      expect(car.object3D!.parent).toBe(scene);
      // Four named wheel nodes (asset convention), and the model starts at the body.
      for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'])
        expect(car.object3D!.getObjectByName(n)).toBeDefined();
      const t = p.getTransform(car.body, { position: new Vector3(), quaternion: new Quaternion() });
      expect(car.object3D!.position.distanceTo(t.position)).toBeLessThan(1e-9);
      expect(car.health).toBe(car.maxHealth);
      expect(car.gear).toBe(1);
    }
  });

  it('headless (view: false) has no model; dispose removes body and model and is idempotent', async () => {
    const p = await physicsWithGround();
    const bodies = p.bodyCount;
    const headless = new Vehicle(p, 'van', { view: false });
    expect(headless.object3D).toBeNull();
    expect(() => headless.addTo(new Scene()).syncView(1)).not.toThrow();

    const scene = new Scene();
    const car = new Vehicle(p, 'sports', { position: { x: 10, y: 0, z: 0 } }).addTo(scene);
    expect(p.vehicleCount).toBe(2);
    expect(p.bodyCount).toBe(bodies + 2);
    car.dispose();
    car.dispose();
    expect(car.isDisposed).toBe(true);
    expect(p.vehicleCount).toBe(1);
    expect(p.bodyCount).toBe(bodies + 1);
    expect(scene.children).not.toContain(car.object3D);
    expect(() => car.update(DT)).toThrow(/after dispose/);
    // The other car keeps working.
    headless.setInput({ throttle: 1 });
    run(p, headless, 1);
    expect(headless.speed).toBeGreaterThan(1);
  });

  it('clamps inputs and ignores NaN', async () => {
    const p = await physicsWithGround();
    const car = new Vehicle(p, 'sedan', { view: false });
    car.setInput({ throttle: 5, brake: -1, steer: -9, handbrake: true });
    expect(car.input).toEqual({ throttle: 1, brake: 0, steer: -1, handbrake: true });
    car.setInput({ throttle: Number.NaN, steer: 0.25 });
    expect(car.input.throttle).toBe(0);
    expect(car.input.steer).toBe(0.25);
    expect(car.input.handbrake).toBe(true); // untouched fields keep their value
  });
});

describe('Vehicle class: driving', () => {
  it('settles on its suspension and stays put with no input', async () => {
    const p = await physicsWithGround();
    const car = new Vehicle(p, 'sedan', { view: false });
    run(p, car, 2);
    const p0 = car.position.clone();
    run(p, car, 5);
    expect(car.position.distanceTo(p0)).toBeLessThan(0.01);
    expect(car.telemetry.wheelsInContact).toBe(4);
    expect(car.up().y).toBeGreaterThan(0.999);
  });

  it('drives forward, brakes, reverses, and steers both ways', async () => {
    const p = await physicsWithGround();
    const car = new Vehicle(p, 'sedan', { view: false });
    run(p, car, 1);
    const start = car.position.clone();

    car.setInput({ throttle: 1 });
    run(p, car, 3);
    expect(car.speed).toBeGreaterThan(10); // > 36 km/h after 3 s
    expect(car.position.z - start.z).toBeGreaterThan(12); // forward = +Z at yaw 0
    expect(Math.abs(car.position.x - start.x)).toBeLessThan(0.2);

    // Steer right: heading decreases (atan2(fwd.x, fwd.z)), car moves towards -X.
    const h0 = car.heading;
    const x0 = car.position.x;
    car.setInput({ throttle: 0.4, steer: 1 });
    run(p, car, 1.5);
    expect(angleDiff(car.heading, h0)).toBeLessThan(-0.4);
    expect(car.position.x).toBeLessThan(x0 - 1);

    // Steer left: heading increases.
    const h1 = car.heading;
    car.setInput({ steer: -1 });
    run(p, car, 1.5);
    expect(angleDiff(car.heading, h1)).toBeGreaterThan(0.4);

    // Brake to a stop, keep holding: reverse engages and the car backs up.
    car.setInput({ throttle: 0, steer: 0, brake: 1 });
    let stoppedAt = -1;
    for (let i = 0; i < 6 * 60 && stoppedAt < 0; i++) {
      tick(p, [car]);
      if (Math.abs(car.speed) < 0.5) stoppedAt = i;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    const back0 = car.position.clone();
    const fwd = car.forward();
    run(p, car, 3);
    expect(car.gear).toBe(-1);
    expect(car.speed).toBeLessThan(-3);
    expect(car.position.clone().sub(back0).dot(fwd)).toBeLessThan(-3); // moved backwards
    expect(car.telemetry.braking).toBe(false); // reversing, not braking: reverse lights off

    // Throttle while reversing brakes, then drives forward again.
    car.setInput({ brake: 0, throttle: 1 });
    run(p, car, 3);
    expect(car.gear).toBeGreaterThanOrEqual(1);
    expect(car.speed).toBeGreaterThan(3);
    expect(car.up().y).toBeGreaterThan(0.95);
  });

  it('honours the spawn heading (yaw 90 degrees drives towards +X)', async () => {
    const p = await physicsWithGround();
    const car = new Vehicle(p, 'compact', { view: false, yaw: Math.PI / 2 });
    expect(car.heading).toBeCloseTo(Math.PI / 2, 5);
    car.setInput({ throttle: 1 });
    run(p, car, 3);
    expect(car.position.x).toBeGreaterThan(10);
    expect(Math.abs(car.position.z)).toBeLessThan(0.3);
  });

  it('reset() puts an upside-down car back on its wheels; damage() wrecks it and cuts drive', async () => {
    const p = await physicsWithGround();
    const car = new Vehicle(p, 'sedan', { view: false });
    p.setTransform(car.body, {
      position: new Vector3(0, 1.5, 0),
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
    });
    run(p, car, 2);
    expect(car.up().y).toBeLessThan(-0.9);
    expect(car.canReset).toBe(true);
    car.reset();
    run(p, car, 2);
    expect(car.up().y).toBeGreaterThan(0.99);
    expect(car.telemetry.wheelsInContact).toBe(4);

    expect(car.damage(car.maxHealth / 2)).toBe(false);
    expect(car.damage(car.maxHealth)).toBe(true);
    expect(car.health).toBe(0);
    car.setInput({ throttle: 1 });
    run(p, car, 2);
    expect(Math.abs(car.speed)).toBeLessThan(0.5);
  });

  it('drives exactly like the ECS vehicle (same physics and drive code)', async () => {
    const p = await physicsWithGround();
    const car = new Vehicle(p, 'police', { view: false, position: ARENA_START });
    const h = await createHarness();
    const e = spawnVehicle(h.world, h.s, 'police', ARENA_START.x, 0, ARENA_START.z, {
      driver: 'ai',
      headless: true,
    });
    const ctl = h.world.require(e, VehicleControl);
    let maxDiff = 0;
    for (let i = 0; i < 12 * 60; i++) {
      const input = arenaDrivePhase(i / 60).input;
      car.setInput(input);
      Object.assign(ctl, input);
      tick(p, [car]);
      h.world.runSim(h.s, DT);
      h.s.events.flush();
      maxDiff = Math.max(maxDiff, car.position.distanceTo(h.world.require(e, Transform).position));
    }
    expect(maxDiff).toBeLessThan(1e-3);
    expect(car.speed).toBeCloseTo(h.world.require(e, VehicleTelemetry).speed, 3);
    h.dispose();
  });
});

describe('Vehicle class: physics and mesh stay synchronized', () => {
  it('mesh follows the body every tick; wheels follow suspension, steering and spin', async () => {
    const p = await physicsWithGround();
    const scene = new Scene();
    const car = new Vehicle(p, 'sedan').addTo(scene);
    const root = car.object3D!;
    const pivots = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map((n) => root.getObjectByName(n)!);
    const spinner = (i: number): Object3D => pivots[i]!.children[0]!;
    const bodyT = { position: new Vector3(), quaternion: new Quaternion() };
    const mid = new Vector3();
    let maxPos = 0;
    let maxRot = 0;
    let maxMid = 0;
    let maxWheel = 0;
    let sawSteer = false;
    const spin0 = spinner(2).rotation.x;

    const script: [number, Partial<typeof car.input>][] = [
      [1, { throttle: 0 }],
      [3, { throttle: 1 }],
      [5, { throttle: 0.4, steer: 1 }],
      [7, { throttle: 0, steer: 0, brake: 1 }],
    ];
    let t = 0;
    for (const [until, input] of script) {
      car.setInput(input);
      for (; t < until * 60; t++) {
        tick(p, [car]);
        p.getTransform(car.body, bodyT);
        // After the tick, the car's transform is the body's.
        expect(car.transform.position.distanceTo(bodyT.position)).toBeLessThan(1e-9);

        // alpha = 1: the mesh is exactly at the body.
        car.syncView(1);
        maxPos = Math.max(maxPos, root.position.distanceTo(bodyT.position));
        // Component-wise (angleTo's acos amplifies float32 rounding near identity).
        const rq = root.quaternion;
        const bq = bodyT.quaternion;
        maxRot = Math.max(
          maxRot,
          Math.abs(rq.x - bq.x),
          Math.abs(rq.y - bq.y),
          Math.abs(rq.z - bq.z),
          Math.abs(rq.w - bq.w),
        );
        // alpha = 0.5: halfway between the last two ticks (interpolation for smooth rendering).
        car.syncView(0.5);
        mid.lerpVectors(car.prevTransform.position, car.transform.position, 0.5);
        maxMid = Math.max(maxMid, root.position.distanceTo(mid));

        for (let i = 0; i < 4; i++) {
          maxWheel = Math.max(maxWheel, Math.abs(pivots[i]!.rotation.y - car.telemetry.steer[i]!));
          maxWheel = Math.max(maxWheel, Math.abs(spinner(i).rotation.x - car.telemetry.spin[i]!));
        }
        if (Math.abs(pivots[0]!.rotation.y) > 0.05) sawSteer = true;
      }
    }
    expect(maxPos).toBeLessThan(1e-9);
    expect(maxRot).toBeLessThan(1e-6); // float rounding in slerp only
    expect(maxMid).toBeLessThan(1e-9);
    expect(maxWheel).toBe(0);
    expect(sawSteer).toBe(true); // front wheels visibly steered during the right turn
    expect(spinner(2).rotation.x).not.toBe(spin0); // wheels rolled

    // Wheel height tracks the suspension: pivot.y = mount.y - suspension length.
    car.syncView(1);
    scene.updateMatrixWorld(true);
    const fl = pivots[0]!;
    const restY = fl.position.y + car.telemetry.suspension[0]!; // = mount.y
    expect(restY).toBeGreaterThan(car.def.wheelRadius);
    car.telemetry.suspension[0] = 0.1;
    car.syncView(1);
    expect(fl.position.y).toBeCloseTo(restY - 0.1, 9);

    // Brake lights follow telemetry.braking (this car's own tail-light material).
    const lampIntensities = (): number[] => {
      const out: number[] = [];
      root.traverse((c) => {
        const m = (c as { material?: { emissive?: unknown; emissiveIntensity?: number } }).material;
        if (m && m.emissive && (m.emissiveIntensity === 2.2 || m.emissiveIntensity === 0.25))
          out.push(m.emissiveIntensity);
      });
      return out;
    };
    car.telemetry.braking = true;
    car.syncView(1);
    expect(lampIntensities()).toEqual([2.2, 2.2]);
    car.telemetry.braking = false;
    car.syncView(1);
    expect(lampIntensities()).toEqual([0.25, 0.25]);

    // The mesh's world matrix agrees with the physics transform (no stray parent offsets).
    const wp = new Vector3();
    root.getWorldPosition(wp);
    expect(wp.distanceTo(bodyT.position)).toBeLessThan(1e-9);
  });
});

describe('Vehicle class: 30-second drive test in the arena', () => {
  it('every vehicle class completes the scripted drive with no errors and sane physics', async () => {
    const layout = arenaLayout();
    expect(ARENA_DRIVE_SECONDS).toBe(30);
    for (const id of Object.keys(VEHICLE_DEFS)) {
      const p = new RapierPhysics();
      await p.init();
      open.push(p);
      createArenaPhysics(p, layout);
      const scene = new Scene();
      scene.add(arenaView(layout));
      const car = new Vehicle(p, id, { position: ARENA_START, yaw: ARENA_START.yaw }).addTo(scene);

      const errors: string[] = [];
      let maxKmh = 0;
      let minKmh = 0;
      let maxAbs = 0;
      let minUp = 1;
      let minY = Infinity;
      let maxY = -Infinity;
      const turn: Record<string, number> = {};
      let phase = '';
      let lastHeading = car.heading;
      for (let i = 0; i < ARENA_DRIVE_SECONDS * 60; i++) {
        const ph = arenaDrivePhase(i / 60);
        if (ph.label !== phase) {
          phase = ph.label;
          turn[phase] = 0;
        }
        try {
          car.setInput(ph.input);
          tick(p, [car]);
          car.syncView(1);
        } catch (err) {
          errors.push(String(err));
          break;
        }
        const q = car.position;
        if (!Number.isFinite(q.x + q.y + q.z + car.speed)) errors.push(`non-finite state at tick ${i}`);
        maxKmh = Math.max(maxKmh, car.speedKmh);
        minKmh = Math.min(minKmh, car.speedKmh);
        maxAbs = Math.max(maxAbs, Math.abs(q.x), Math.abs(q.z));
        minUp = Math.min(minUp, car.up().y);
        // Accumulated heading change per phase (unwrapped, so turns past 180 degrees count).
        turn[phase] = turn[phase]! + angleDiff(car.heading, lastHeading);
        lastHeading = car.heading;
        minY = Math.min(minY, q.y);
        maxY = Math.max(maxY, q.y);
      }

      const ctx = `${id}: ${JSON.stringify({ maxKmh, minKmh, maxAbs, minUp, minY, maxY, turn })}`;
      expect(errors, ctx).toEqual([]);
      expect(maxKmh, ctx).toBeGreaterThan(40); // accelerated forward
      expect(minKmh, ctx).toBeLessThan(-20); // reversed
      expect(turn['turn right']!, ctx).toBeLessThan(-1); // turned right > 57 degrees
      expect(turn['turn left']!, ctx).toBeGreaterThan(1); // turned left
      expect(maxAbs, ctx).toBeLessThan(layout.half - 5); // stayed inside the walls
      expect(minUp, ctx).toBeGreaterThan(0.9); // never rolled
      expect(minY, ctx).toBeGreaterThan(-0.1); // never sank through the ground
      expect(maxY, ctx).toBeLessThan(1); // never launched
      expect(Math.abs(car.speed), ctx).toBeLessThan(1); // handbrake stopped it
      expect(car.object3D!.position.distanceTo(car.position), ctx).toBeLessThan(1e-9);
      car.dispose();
    }
    expect(ARENA_DRIVE_SCRIPT.length).toBeGreaterThan(5);
  });

  it('runs inside GameLoop with irregular frame times (render interpolation, no errors)', async () => {
    const p = await physicsWithGround();
    const scene = new Scene();
    const car = new Vehicle(p, 'sports', { position: ARENA_START }).addTo(scene);
    const rival = new Vehicle(p, 'van', { position: { x: ARENA_START.x + 8, y: 0, z: ARENA_START.z } });
    rival.addTo(scene);
    let simTime = 0;
    let outside = 0;
    const seg = new Vector3();
    const off = new Vector3();
    const loop = new GameLoop({
      step(dt) {
        car.setInput(arenaDrivePhase(simTime).input);
        rival.setInput({ throttle: 0.5, steer: 0.3 });
        car.update(dt);
        rival.update(dt);
        p.step(dt);
        car.postStep();
        rival.postStep();
        simTime += dt;
      },
      render(alpha) {
        car.syncView(alpha);
        rival.syncView(alpha);
        // The drawn car lies on the segment between the last two physics positions.
        seg.subVectors(car.transform.position, car.prevTransform.position);
        off.subVectors(car.object3D!.position, car.prevTransform.position);
        const along = seg.lengthSq() > 0 ? off.dot(seg) / seg.lengthSq() : 0;
        if (along < -1e-6 || along > 1 + 1e-6 || off.sub(seg.multiplyScalar(along)).length() > 1e-6)
          outside++;
      },
    });
    // 30 s of real time at uneven frame rates (12-144 fps). One 0.2 s hitch per cycle is more
    // than maxSubSteps (5) ticks, so the loop drops that excess instead of spiralling.
    const frames = [1 / 144, 1 / 60, 1 / 33, 1 / 25, 1 / 12, 1 / 90, 0.2];
    let elapsed = 0;
    for (let f = 0; elapsed < 30; f++) {
      const dt = frames[f % frames.length]!;
      loop.advance(dt);
      elapsed += dt;
    }
    // Every real second is either simulated or explicitly dropped (within one tick).
    expect(Math.abs(loop.ticks * DT + loop.droppedTime - elapsed)).toBeLessThan(DT);
    expect(loop.ticks).toBeGreaterThan(1200); // > 20 s of game time driven
    expect(loop.droppedTime).toBeGreaterThan(0);
    expect(simTime).toBeCloseTo(loop.ticks * DT, 6);
    expect(outside).toBe(0);
    expect(Number.isFinite(car.position.x + car.position.z)).toBe(true);
    expect(car.up().y).toBeGreaterThan(0.9);
    expect(rival.up().y).toBeGreaterThan(0.9);
    expect(rival.position.distanceTo(new Vector3(ARENA_START.x + 8, 0, ARENA_START.z))).toBeGreaterThan(20);
  });
});
