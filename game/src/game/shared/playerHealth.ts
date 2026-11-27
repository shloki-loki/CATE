import type { Entity } from '../../core';
import type { GameSystem, GameWorld } from '../../services';
import type { GameEvents } from '../events';
import { Health, PlayerRecord, Vehicle } from '../components';
import { findPlayer } from './player';

export const PLAYER_MAX_HP = 100;
/** Driver injury per point of collision damage their car takes (car max health is 1000). */
export const INJURY_PER_CAR_DAMAGE = 0.12;
/** Health comes back at this rate (hp/s) once the player has not been hurt for REGEN_DELAY s. */
export const REGEN_RATE = 2;
export const REGEN_DELAY = 6;

/**
 * gameplay: the player's own health (T0028). Hard crashes hurt the driver in proportion
 * to the damage their car takes, and health slowly comes back after a while unhurt.
 * Death and respawn belong to the combat/player tasks; until then health stops at 0.
 */
export function PlayerHealthSystem(): GameSystem {
  let entity: Entity | null = null;
  let world: GameWorld | null = null;
  let simTime = 0;

  const onDamage = (d: GameEvents['damage']): void => {
    if (!world || entity === null || !world.isAlive(entity)) return;
    if (d.kind !== 'collision') return;
    const p = findPlayer(world);
    if (!p || !p.inVehicle || d.target !== p.entity || !world.get(p.entity, Vehicle)) return;
    const h = world.require(entity, Health);
    h.hp = Math.max(0, h.hp - d.amount * INJURY_PER_CAR_DAMAGE);
    world.require(entity, PlayerRecord).hurtAt = simTime;
  };

  return {
    name: 'player.health',
    phase: 'gameplay',
    init(w, s) {
      world = w;
      entity = w.createEntity();
      w.add(entity, Health, { hp: PLAYER_MAX_HP, armor: 0 });
      w.add(entity, PlayerRecord, { maxHp: PLAYER_MAX_HP, maxArmor: 100, hurtAt: -Infinity });
      s.events.on('damage', onDamage);
    },
    update(w, _s, dt) {
      simTime += dt;
      if (entity === null || !w.isAlive(entity)) return;
      const h = w.require(entity, Health);
      const rec = w.require(entity, PlayerRecord);
      if (h.hp > 0 && h.hp < rec.maxHp && simTime - rec.hurtAt >= REGEN_DELAY)
        h.hp = Math.min(rec.maxHp, h.hp + REGEN_RATE * dt);
    },
  };
}
