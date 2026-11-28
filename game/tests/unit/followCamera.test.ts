import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CameraRig,
  createPlayer,
  FollowCameraSystems,
  PhysicsStepSystem,
  PhysicsSyncSystem,
  PlayerSystems,
  Transform,
  ViewSyncSystem,
  type CameraRigData,
} from '../../src/game';
import { armDirection, FollowCameraState, FOLLOW } from '../../src/game/camera';
import { CollisionGroup } from '../../src/physics';
import { makeServices, newWorld } from './harness';

const DT = 1 / 60;

function rig(over: Partial<CameraRigData> = {}): CameraRigData {
  return {
    yaw: 0,
    pitch: 0.3,
    distance: 4,
    minDistance: 2,
    maxDistance: 9,
    height: 0.6,
    follow: null,
    autoRecenter: false,
    lookIdle: 0,
    ...over,
  };
}

describe('FollowCameraState (pure)', () => {
  const clear = () => null;

  it('sits behind and above the target at the rig distance, looking along the rig yaw', () => {
    const cam = new FollowCameraState();
    const r = rig();
    const target = new Vector3(10, 0, 5);
    const p = cam.update(target, r, DT, clear);
    expect(cam.pivot.distanceTo(new Vector3(10, 0.6, 5))).toBeLessThan(1e-9);
    expect(p.distanceTo(cam.pivot)).toBeCloseTo(4, 6);
    expect(p.z).toBeGreaterThan(5); // yaw 0: camera on +Z
    expect(p.y).toBeGreaterThan(0.6); // pitched down at the target
  });

  it('follows a moving target smoothly with bounded lag and no overshoot', () => {
    const cam = new FollowCameraState();
    const r = rig();
    const target = new Vector3();
    cam.update(target, r, DT, clear);
    let prevZ = cam.position.z;
    let maxStep = 0;
    // Sprint at 7.2 m/s toward -Z for 3 s.
    for (let i = 0; i < 180; i++) {
      target.z -= 7.2 * DT;
      cam.update(target, r, DT, clear);
      const step = prevZ - cam.position.z;
      expect(step).toBeGreaterThanOrEqual(-1e-9); // never moves backwards
      maxStep = Math.max(maxStep, step);
      prevZ = cam.position.z;
    }
    expect(maxStep).toBeLessThan(7.2 * DT + 1e-6); // never faster than the target: no jumps
    const lag = cam.pivot.z - target.z;
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(0.5); // stays close behind
    // Target stops: the camera settles exactly behind it.
    for (let i = 0; i < 120; i++) cam.update(target, r, DT, clear);
    expect(Math.abs(cam.pivot.z - target.z)).toBeLessThan(1e-3);
  });

  it('smooths vertical motion more than horizontal (jumps do not jolt the view)', () => {
    const cam = new FollowCameraState();
    const r = rig();
    const target = new Vector3();
    cam.update(target, r, DT, clear);
    target.set(1, 1, 0);
    cam.update(target, r, DT, clear);
    expect(cam.pivot.x).toBeGreaterThan(cam.pivot.y - 0.6);
  });

  it('turns with the rig yaw by the shortest way, including across ±π', () => {
    const cam = new FollowCameraState();
    const r = rig({ yaw: 3.0 });
    const t = new Vector3();
    cam.update(t, r, DT, clear);
    r.yaw = -3.0; // 0.28 rad away going through π, not 6 rad the other way
    for (let i = 0; i < 60; i++) cam.update(t, r, DT, clear);
    expect(Math.abs(Math.abs(cam.yaw) - 3.0)).toBeLessThan(0.01);
    expect(Math.sign(cam.yaw)).toBe(-1);
  });

  it('pulls in instantly when something blocks the arm and eases back out when clear', () => {
    const cam = new FollowCameraState();
    const r = rig({ distance: 6 });
    const t = new Vector3();
    cam.update(t, r, DT, clear);
    expect(cam.arm).toBeCloseTo(6, 6);
    cam.update(t, r, DT, () => 1.5);
    expect(cam.arm).toBeCloseTo(1.5, 6); // same frame
    cam.update(t, r, DT, () => 0);
    expect(cam.arm).toBe(FOLLOW.minArm);
    const arms: number[] = [];
    for (let i = 0; i < 120; i++) arms.push(cam.update(t, r, DT, clear) && cam.arm);
    for (let i = 1; i < arms.length; i++) expect(arms[i]!).toBeGreaterThanOrEqual(arms[i - 1]!);
    expect(arms[5]!).toBeLessThan(3); // not a snap
    expect(arms.at(-1)!).toBeGreaterThan(5.9);
  });

  it('snaps after a teleport instead of flying across the map', () => {
    const cam = new FollowCameraState();
    const r = rig();
    cam.update(new Vector3(), r, DT, clear);
    cam.update(new Vector3(500, 0, 0), r, DT, clear);
    expect(cam.pivot.x).toBeCloseTo(500, 6);
  });

  it('armDirection is a unit vector pointing back along the yaw', () => {
    const d = armDirection(Math.PI / 2, 0, new Vector3());
    expect(d.length()).toBeCloseTo(1, 9);
    expect(d.x).toBeCloseTo(1, 9);
  });
});

describe('follow camera in the game loop (ECS + Rapier)', () => {
  async function setup() {
    const { s, physics, input } = await makeServices();
    const world = newWorld();
    for (const sys of FollowCameraSystems()) world.addSystem(sys);
    for (const sys of PlayerSystems()) world.addSystem(sys);
    world.addSystem(PhysicsStepSystem);
    world.addSystem(PhysicsSyncSystem);
    world.addSystem(ViewSyncSystem);
    await world.init(s);
    physics.createBody({
      type: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      shapes: [{ kind: 'box', halfExtents: { x: 100, y: 0.5, z: 100 } }],
    });
    const run = (seconds: number, each?: () => void): void => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        each?.();
        input.poll();
        world.runSim(s, DT);
        s.events.flush();
        s.clock.alpha = 1;
        world.runFrame(s, DT);
      }
    };
    return { s, physics, input, world, run };
  }

  it('stays behind the walking player and looks at them', async () => {
    const { s, input, world, run } = await setup();
    const p = createPlayer(world, s, { x: 0, y: 0.95, z: 0 }, 0);
    run(0.5);
    input.axes.moveY = 1;
    run(2);
    const cam = s.render.camera;
    const pp = world.require(p, Transform).position;
    expect(pp.z).toBeLessThan(-6);
    const d = cam.position.distanceTo(pp);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(6);
    expect(cam.position.z).toBeGreaterThan(pp.z); // behind (player walks toward -Z)
    // Looking at the player: the player is near the centre of the view.
    const toPlayer = pp.clone().sub(cam.position).normalize();
    const look = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(look.dot(toPlayer)).toBeGreaterThan(0.97);
  });

  it('mouse look orbits the camera and WASD then moves relative to the new view', async () => {
    const { s, input, world, run } = await setup();
    const p = createPlayer(world, s, { x: 0, y: 0.95, z: 0 }, 0);
    run(0.3);
    // Drag left by enough pixels for +90°.
    const px = Math.PI / 2 / FOLLOW.mouseRadPerPx;
    input.axes.lookX = -px;
    run(1 / 60);
    input.axes.lookX = 0;
    run(0.5);
    const r = world.require(p, CameraRig);
    expect(r.yaw).toBeCloseTo(Math.PI / 2, 3);
    const cam = s.render.camera;
    const pp = world.require(p, Transform).position;
    expect(cam.position.x).toBeGreaterThan(pp.x + 2); // camera swung to +X
    input.axes.moveY = 1;
    run(1);
    expect(pp.x).toBeLessThan(-2); // forward is now -X
    expect(Math.abs(pp.z)).toBeLessThan(0.1);
  });

  it('never ends up inside a building: the arm shortens against walls', async () => {
    const { s, physics, input, world, run } = await setup();
    // Building directly behind the player (camera side), its face 1.5 m behind them.
    physics.createBody({
      type: 'static',
      position: { x: 0, y: 10, z: 7.5 },
      shapes: [{ kind: 'box', halfExtents: { x: 10, y: 10, z: 6 } }],
      group: CollisionGroup.WORLD_STATIC,
    });
    const p = createPlayer(world, s, { x: 0, y: 0.95, z: 0 }, 0);
    run(1);
    const cam = s.render.camera;
    expect(cam.position.z).toBeLessThan(1.5 - FOLLOW.probeRadius + 0.02);
    expect(cam.position.distanceTo(world.require(p, Transform).position)).toBeGreaterThan(0.3);
    // Look at it from many angles: the camera is never inside the block.
    for (let k = 0; k < 24; k++) {
      input.axes.lookX = 40;
      input.axes.lookY = k % 2 ? 15 : -15;
      run(2 / 60, () => {
        const c = cam.position;
        const inside = Math.abs(c.x) < 10 && c.y < 20 && c.z > 1.5 && c.z < 13.5;
        expect(inside).toBe(false);
        expect(c.y).toBeGreaterThan(0); // nor under the ground
      });
    }
  });
});
