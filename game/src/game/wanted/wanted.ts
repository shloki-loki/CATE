import type { Entity } from '../../core';
import type { GameSystem, GameWorld } from '../../services';
import type { GameEvents } from '../events';
import { Vehicle, WantedLevel, type WantedLevelData } from '../components';
import { findPlayer } from '../shared';

export const MAX_WANTED_STARS = 5;
/**
 * One crash produces several contact events over a few ticks (and scraping along a car
 * produces more). Collisions within this many seconds of a counted crash are the same crash.
 */
export const CRASH_DEBOUNCE = 1.0;

export type Offence = 'crash' | 'police';

/** Heat (stars) one offence adds: ramming a police car is worth two stars, any other crash one. */
export function offenceHeat(o: Offence): number {
  return o === 'police' ? 2 : 1;
}

/** Seconds without a new offence before one star is lost; higher levels take longer to shake. */
export function starDecayTime(stars: number): number {
  return 10 + 3 * stars;
}

function emptyWanted(): WantedLevelData {
  return { stars: 0, heat: 0, quiet: 0, coolDownIn: null, revision: 0, offences: 0 };
}

/**
 * gameplay: keeps the player's wanted level on one WantedLevel entity. Every collision
 * the player's car (or, later, the on-foot player) is part of counts as an offence and
 * adds stars, at most one offence per CRASH_DEBOUNCE seconds. Stars then drop one at a
 * time after a quiet spell (starDecayTime). Emits `wantedChanged` on every change.
 */
export function WantedSystem(): GameSystem {
  let entity: Entity | null = null;
  let world: GameWorld | null = null;
  let sinceCrash = Infinity;
  const pending: Offence[] = [];

  const onCollision = (c: GameEvents['collision']): void => {
    if (!world) return;
    const p = findPlayer(world);
    if (!p) return;
    const other = c.a === p.entity ? c.b : c.b === p.entity ? c.a : undefined;
    if (other === undefined) return;
    if (sinceCrash < CRASH_DEBOUNCE) return;
    sinceCrash = 0;
    const v = other === null ? undefined : world.get(other, Vehicle);
    pending.push(v?.defId === 'police' ? 'police' : 'crash');
  };

  return {
    name: 'wanted',
    phase: 'gameplay',
    init(w, s) {
      world = w;
      entity = w.createEntity();
      w.add(entity, WantedLevel, emptyWanted());
      s.events.on('collision', onCollision);
    },
    update(w, s, dt) {
      sinceCrash += dt;
      if (entity === null || !w.isAlive(entity)) return;
      const wl = w.require(entity, WantedLevel);
      const before = wl.stars;
      let cause = 'cooldown';
      if (pending.length > 0) {
        for (const o of pending) {
          wl.heat = Math.min(MAX_WANTED_STARS, wl.heat + offenceHeat(o));
          wl.offences++;
          cause = o;
        }
        pending.length = 0;
        wl.quiet = 0;
      } else {
        wl.quiet += dt;
        if (wl.stars > 0 && wl.quiet >= starDecayTime(wl.stars)) {
          wl.heat = wl.stars - 1;
          wl.quiet = 0;
        }
      }
      wl.stars = Math.min(MAX_WANTED_STARS, Math.floor(wl.heat + 1e-9));
      wl.coolDownIn = wl.stars > 0 ? Math.max(0, starDecayTime(wl.stars) - wl.quiet) : null;
      if (wl.stars !== before) {
        if (wl.stars > before) wl.revision++;
        s.events.emit('wantedChanged', { stars: wl.stars, previous: before, cause });
      }
    },
  };
}
