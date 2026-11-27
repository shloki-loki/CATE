import type { Entity } from '../core';

/**
 * ALL event types live here (T0016 §4.5). Events are queued and delivered once per
 * sim tick by EventBus.flush(). Later tasks add their events here.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface GameEvents {
  [key: string]: unknown;
  /** A hard contact. `b` is null when `a` hit static world geometry (buildings, ground). */
  collision: { a: Entity; b: Entity | null; impulse: number; point: Vec3Like | null };
  vehicleEntered: { entity: Entity; vehicle: Entity; stolen: boolean };
  vehicleExited: { entity: Entity; vehicle: Entity };
  damage: { target: Entity; amount: number; source: Entity | null; kind: string };
  death: { entity: Entity; cause: string };
  zoneEntered: { zone: string };
  /** The player pressed interact next to an Interactable (T0021). Owners of `kind` react. */
  interact: { entity: Entity; target: Entity; kind: string };
  /** A character touched the ground after falling at `speed` m/s (fall damage, landing sounds). */
  landed: { entity: Entity; speed: number };
  chunkLoaded: { chunkId: string };
  chunkUnloaded: { chunkId: string };
  'ui:pause': Record<string, never>;
  'ui:resume': Record<string, never>;
  'ui:setting': { key: string; value: unknown };
}
