import { PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three';
import { AssetRegistry } from '../../src/assets';
import { NullAudio } from '../../src/audio';
import { createClock, EventBus, Settings, TimeOfDay, World } from '../../src/core';
import {
  PhysicsStepSystem,
  PhysicsSyncSystem,
  Transform,
  VehicleSystems,
  ChaseCameraSystem,
  ViewSyncSystem,
  type GameEvents,
} from '../../src/game';
import type { Axis, Button, InputAPI } from '../../src/input';
import { CollisionGroup, RapierPhysics } from '../../src/physics';
import type { RenderAPI } from '../../src/render';
import type { Services } from '../../src/services';

/** Headless stand-in for ThreeRenderer. */
export class RecordingRender implements RenderAPI {
  readonly camera = new PerspectiveCamera();
  readonly added: Object3D[] = [];
  async init(): Promise<void> {}
  addToWorld(o: Object3D): void {
    this.added.push(o);
  }
  remove(o: Object3D): void {
    const i = this.added.indexOf(o);
    if (i >= 0) this.added.splice(i, 1);
  }
  setTimeOfDay(): void {}
  setQuality(): void {}
  render(): void {}
  stats() {
    return { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
  }
  dispose(): void {}
}

/** Input whose actions tests set directly. */
export class ScriptedInput implements InputAPI {
  readonly pointerLocked = false;
  axes: Partial<Record<Axis, number>> = {};
  held = new Set<Button>();
  private justPressed = new Set<Button>();
  private queued = new Set<Button>();
  poll(): void {
    this.justPressed = this.queued;
    this.queued = new Set();
  }
  axis(a: Axis): number {
    return this.axes[a] ?? 0;
  }
  down(b: Button): boolean {
    return this.held.has(b);
  }
  pressed(b: Button): boolean {
    return this.justPressed.has(b);
  }
  /** Report `b` as pressed on the next poll. */
  tap(b: Button): void {
    this.queued.add(b);
  }
  set(throttle: number, brake: number, steer: number, handbrake = false): void {
    this.axes.throttle = throttle;
    this.axes.brake = brake;
    this.axes.steer = steer;
    if (handbrake) this.held.add('handbrake');
    else this.held.delete('handbrake');
  }
  dispose(): void {}
}

export interface Harness {
  world: World<Services>;
  s: Services;
  physics: RapierPhysics;
  input: ScriptedInput;
  render: RecordingRender;
  events: { type: string; payload: unknown }[];
  /** Run `seconds` of simulation at 60 Hz, plus one frame at the end. */
  run(seconds: number, each?: (tick: number) => void): void;
  wall(x: number, z: number, hx: number, hz: number, h?: number): void;
  dispose(): void;
}

export async function createHarness(groundHalf = 6000): Promise<Harness> {
  const physics = new RapierPhysics();
  await physics.init();
  const render = new RecordingRender();
  const input = new ScriptedInput();
  const s: Services = {
    physics,
    render,
    audio: new NullAudio(),
    input,
    assets: new AssetRegistry('./', { version: 1, assets: {} }),
    events: new EventBus<GameEvents>(),
    settings: new Settings(null),
    time: new TimeOfDay(),
    clock: createClock(),
  };
  const events: Harness['events'] = [];
  for (const type of ['collision', 'damage', 'death'] as const)
    s.events.on(type, (payload) => events.push({ type, payload }));
  const world = new World<Services>();
  world.addSystem({ name: 'inputPoll', phase: 'input', update: (_w, sv) => sv.input.poll() });
  world.addSystem(PhysicsStepSystem);
  world.addSystem(PhysicsSyncSystem);
  for (const sys of VehicleSystems()) world.addSystem(sys);
  for (const sys of ChaseCameraSystem()) world.addSystem(sys);
  world.addSystem(ViewSyncSystem);
  await world.init(s);
  physics.createBody({
    type: 'static',
    position: { x: 0, y: -0.5, z: 0 },
    shapes: [{ kind: 'box', halfExtents: { x: groundHalf, y: 0.5, z: groundHalf } }],
    group: CollisionGroup.WORLD_STATIC,
    friction: 0.9,
  });
  return {
    world,
    s,
    physics,
    input,
    render,
    events,
    run(seconds, each) {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        each?.(i);
        world.runSim(s, 1 / 60);
        s.events.flush();
        s.clock.tick++;
      }
      s.clock.alpha = 1;
      world.runFrame(s, 1 / 60);
    },
    wall(x, z, hx, hz, h = 3) {
      physics.createBody({
        type: 'static',
        position: { x, y: h / 2, z },
        shapes: [{ kind: 'box', halfExtents: { x: hx, y: h / 2, z: hz } }],
        group: CollisionGroup.WORLD_STATIC,
      });
    },
    dispose() {
      physics.dispose();
    },
  };
}

export function pos(h: Harness, e: number): Vector3 {
  return h.world.require(e, Transform).position.clone();
}

/** World up-vector of the chassis (y = 1 upright, < 0 upside down). */
export function upY(h: Harness, e: number): number {
  return new Vector3(0, 1, 0).applyQuaternion(h.world.require(e, Transform).quaternion).y;
}

export function heading(h: Harness, e: number): number {
  const f = new Vector3(0, 0, 1).applyQuaternion(h.world.require(e, Transform).quaternion);
  return Math.atan2(f.x, f.z);
}

export { Quaternion };
