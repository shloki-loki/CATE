import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../../src/assets';
import { NullAudio } from '../../src/audio';
import { createClock, EventBus, Settings, TimeOfDay, World } from '../../src/core';
import {
  createDemoScene,
  PhysicsStepSystem,
  PhysicsSyncSystem,
  Transform,
  View,
  ViewSyncSystem,
  type GameEvents,
} from '../../src/game';
import { NullInput } from '../../src/input';
import { RapierPhysics } from '../../src/physics';
import type { RenderAPI } from '../../src/render';
import type { Services } from '../../src/services';
import { PerspectiveCamera } from 'three';

/** Headless stand-in for ThreeRenderer: records what would be drawn. */
class RecordingRender implements RenderAPI {
  readonly camera = new PerspectiveCamera();
  readonly added: Object3D[] = [];
  async init(): Promise<void> {}
  addToWorld(o: Object3D): void {
    this.added.push(o);
  }
  remove(): void {}
  setTimeOfDay(): void {}
  setQuality(): void {}
  render(): void {}
  stats() {
    return { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
  }
  dispose(): void {}
}

describe('demo scene (headless integration: ECS + Rapier + view sync)', () => {
  it('builds deterministically and dynamic bodies settle on the ground without falling through', async () => {
    const physics = new RapierPhysics();
    await physics.init();
    const render = new RecordingRender();
    const s: Services = {
      physics,
      render,
      audio: new NullAudio(),
      input: new NullInput(),
      assets: new AssetRegistry('./', { version: 1, assets: {} }),
      events: new EventBus<GameEvents>(),
      settings: new Settings(null),
      time: new TimeOfDay(),
      clock: createClock(),
    };
    const world = new World<Services>();
    world.addSystem(PhysicsStepSystem);
    world.addSystem(PhysicsSyncSystem);
    world.addSystem(ViewSyncSystem);
    await world.init(s);

    const scene = createDemoScene(world, s, 1986);
    expect(scene.buildings).toBeGreaterThan(10);
    expect(scene.dynamic.length).toBe(14);
    expect(scene.playground).toBeGreaterThan(10);
    expect(render.added.length).toBeGreaterThan(scene.buildings);
    expect(physics.bodyCount).toBe(1 + scene.buildings + scene.playground + scene.dynamic.length);

    for (let i = 0; i < 60 * 8; i++) world.runSim(s, 1 / 60);
    s.clock.alpha = 1;
    world.runFrame(s, 1 / 60);

    for (const e of scene.dynamic) {
      const t = world.require(e, Transform);
      expect(t.position.y).toBeGreaterThan(0.2); // on top of the ground, not through it
      expect(t.position.y).toBeLessThan(6); // fell and stacked/settled
      const v = world.require(e, View).object3D;
      expect(v.position.distanceTo(t.position)).toBeLessThan(1e-6); // view synced at alpha = 1
    }

    // Same seed => same layout.
    const again = createDemoScene(new World<Services>(), { ...s, render: new RecordingRender() }, 1986);
    expect(again.buildings).toBe(scene.buildings);
    physics.dispose();
  });
});
