import { PerspectiveCamera, type Object3D } from 'three';
import { AssetRegistry } from '../../src/assets';
import { NullAudio } from '../../src/audio';
import { createClock, EventBus, Settings, TimeOfDay, World } from '../../src/core';
import type { GameEvents } from '../../src/game';
import type { Axis, Button, InputAPI } from '../../src/input';
import { RapierPhysics } from '../../src/physics';
import type { RenderAPI } from '../../src/render';
import type { Services } from '../../src/services';

/** Headless stand-in for ThreeRenderer: records what would be drawn. */
export class RecordingRender implements RenderAPI {
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

/** Input driven by the test: set axes and hold/tap buttons. */
export class ScriptedInput implements InputAPI {
  readonly pointerLocked = false;
  axes: Partial<Record<Axis, number>> = {};
  held = new Set<Button>();
  private taps = new Set<Button>();
  private pressedNow = new Set<Button>();
  tap(b: Button): void {
    this.taps.add(b);
  }
  poll(): void {
    this.pressedNow = this.taps;
    this.taps = new Set();
  }
  axis(a: Axis): number {
    return this.axes[a] ?? 0;
  }
  down(b: Button): boolean {
    return this.held.has(b) || this.pressedNow.has(b);
  }
  pressed(b: Button): boolean {
    return this.pressedNow.has(b);
  }
  dispose(): void {}
}

export async function makeServices(): Promise<{
  s: Services;
  physics: RapierPhysics;
  input: ScriptedInput;
  render: RecordingRender;
}> {
  const physics = new RapierPhysics();
  await physics.init();
  const input = new ScriptedInput();
  const render = new RecordingRender();
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
  return { s, physics, input, render };
}

export function newWorld(): World<Services> {
  return new World<Services>();
}
