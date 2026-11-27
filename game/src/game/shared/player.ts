import type { Entity } from '../../core';
import type { GameWorld } from '../../services';
import { Driver, PlayerTag, Transform, Vehicle, type TransformData } from '../components';

export interface PlayerRef {
  /** The entity whose position is the player's: their car while driving, else the character. */
  entity: Entity;
  transform: TransformData;
  /** True when `entity` is a vehicle driven by the player. */
  inVehicle: boolean;
}

/** Finds the player: the vehicle they drive first, else the on-foot character (PlayerTag). */
export function findPlayer(world: GameWorld): PlayerRef | null {
  for (const e of world.query(Vehicle, Driver, Transform)) {
    if (world.require(e, Driver).mode === 'player')
      return { entity: e, transform: world.require(e, Transform), inVehicle: true };
  }
  for (const e of world.query(PlayerTag, Transform)) {
    return { entity: e, transform: world.require(e, Transform), inVehicle: false };
  }
  return null;
}
