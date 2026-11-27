import type { AssetAPI } from './assets';
import type { AudioAPI } from './audio';
import type { Clock, EventBus, Settings, System, TimeOfDay, World } from './core';
import type { GameEvents } from './game';
import type { InputAPI } from './input';
import type { PhysicsAPI } from './physics';
import type { RenderAPI } from './render';

/**
 * The one services object passed to every system (T0016 §4.3). No global singletons,
 * so tests can pass mocks. Lives outside core/ so core stays dependency-free.
 */
export interface Services {
  physics: PhysicsAPI;
  render: RenderAPI;
  audio: AudioAPI;
  input: InputAPI;
  assets: AssetAPI;
  events: EventBus<GameEvents>;
  settings: Settings;
  time: TimeOfDay;
  clock: Clock;
}

export type GameWorld = World<Services>;
export type GameSystem = System<Services>;
