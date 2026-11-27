import { describe, expect, it } from 'vitest';
import {
  CRASH_DEBOUNCE,
  Health,
  MAX_WANTED_STARS,
  PLAYER_MAX_HP,
  PlayerHealthSystem,
  PlayerRecord,
  REGEN_DELAY,
  spawnVehicle,
  starDecayTime,
  Vehicle,
  VehicleTelemetry,
  WantedLevel,
  WantedSystem,
  type GameEvents,
} from '../../src/game';
import { createHudReader } from '../../src/hudBridge';
import { createHarness, type Harness } from './vehicleHarness';

/**
 * T0028: the wanted level goes up when the player's car crashes, comes back down after a
 * quiet spell, and the player's own health drops in hard crashes. Uses the real physics.
 */
async function setup(
  defId = 'sedan',
): Promise<{ h: Harness; car: number; changes: GameEvents['wantedChanged'][] }> {
  const h = await createHarness();
  h.world.addSystem(WantedSystem());
  h.world.addSystem(PlayerHealthSystem());
  const changes: GameEvents['wantedChanged'][] = [];
  h.s.events.on('wantedChanged', (c) => changes.push(c));
  const car = spawnVehicle(h.world, h.s, defId, 0, 0, 0, { driver: 'player', headless: true });
  return { h, car, changes };
}

function wanted(h: Harness) {
  return h.world.require(h.world.query(WantedLevel)[0]!, WantedLevel);
}

function playerHp(h: Harness): number {
  return h.world.require(h.world.query(PlayerRecord, Health)[0]!, Health).hp;
}

function accelerateTo(h: Harness, car: number, speed: number): void {
  h.input.set(1, 0, 0);
  for (let i = 0; i < 30 * 60 && h.world.require(car, VehicleTelemetry).speed < speed; i++) h.run(1 / 60);
}

describe('wanted level (T0028)', () => {
  it('starts at zero stars and stays there while driving without hitting anything', async () => {
    const { h, car, changes } = await setup();
    h.run(1);
    expect(wanted(h).stars).toBe(0);
    accelerateTo(h, car, 20);
    h.run(3);
    expect(wanted(h).stars).toBe(0);
    expect(changes).toEqual([]);
    h.dispose();
  });

  it('ramming a parked car adds one star, once per crash', async () => {
    const { h, car, changes } = await setup();
    spawnVehicle(h.world, h.s, 'compact', 0, 0, 30, { headless: true, yaw: Math.PI / 2 });
    h.run(1);
    accelerateTo(h, car, 12);
    h.input.set(0, 0, 0);
    h.run(4);
    const hits = h.events.filter((x) => x.type === 'collision').length;
    expect(hits).toBeGreaterThan(0);
    expect(wanted(h).stars).toBe(1);
    expect(wanted(h).offences).toBe(1);
    expect(wanted(h).revision).toBe(1);
    expect(changes).toEqual([{ stars: 1, previous: 0, cause: 'crash' }]);
    h.dispose();
  });

  it('ramming a police car adds two stars', async () => {
    const { h, car } = await setup();
    spawnVehicle(h.world, h.s, 'police', 0, 0, 30, { headless: true, yaw: Math.PI / 2 });
    h.run(1);
    accelerateTo(h, car, 12);
    h.input.set(0, 0, 0);
    h.run(4);
    expect(wanted(h).stars).toBe(2);
    h.dispose();
  });

  it('a crash into a wall counts, and separate crashes add up to the five-star maximum', async () => {
    const { h, car } = await setup('sports');
    h.wall(0, 25, 10, 0.5);
    let stars = 0;
    const hits = (): number => h.events.filter((x) => x.type === 'collision').length;
    for (let crash = 1; crash <= 7; crash++) {
      accelerateTo(h, car, 9);
      h.input.set(0, 0, 0); // coast in, so the car hits the wall once and rolls back
      const before = hits();
      for (let i = 0; i < 80 && hits() === before; i++) h.run(0.1);
      expect(hits()).toBeGreaterThan(before);
      h.run(1);
      const now = wanted(h).stars;
      expect(now).toBe(Math.min(MAX_WANTED_STARS, stars + 1));
      stars = now;
      // Back away from the wall for the next crash, and keep the car driveable.
      h.input.set(0, 1, 0);
      h.run(2);
      h.input.set(0, 0, 0);
      h.run(CRASH_DEBOUNCE);
      h.world.require(car, Vehicle).health = h.world.require(car, Vehicle).maxHealth;
    }
    expect(stars).toBe(MAX_WANTED_STARS);
    h.dispose();
  });

  it('loses one star at a time after a quiet spell, down to zero', async () => {
    const { h, car, changes } = await setup();
    const at: number[] = [];
    h.s.events.on('wantedChanged', () => at.push(h.s.clock.tick / 60));
    spawnVehicle(h.world, h.s, 'police', 0, 0, 30, { headless: true, yaw: Math.PI / 2 });
    h.run(1);
    accelerateTo(h, car, 12);
    h.input.set(0, 0, 0);
    h.run(4);
    expect(wanted(h).stars).toBe(2);
    const w = wanted(h);
    expect(w.coolDownIn).toBeGreaterThan(0);
    expect(w.coolDownIn).toBeLessThanOrEqual(starDecayTime(2));
    h.run(starDecayTime(2) + starDecayTime(1));
    expect(wanted(h).stars).toBe(0);
    expect(wanted(h).coolDownIn).toBeNull();
    expect(changes.map((c) => [c.stars, c.cause])).toEqual([
      [2, 'police'],
      [1, 'cooldown'],
      [0, 'cooldown'],
    ]);
    // Each star lasts exactly its decay time (the car stood still, so no new offence).
    expect(at[1]! - at[0]!).toBeCloseTo(starDecayTime(2), 1);
    expect(at[2]! - at[1]!).toBeCloseTo(starDecayTime(1), 1);
    h.dispose();
  });
});

describe('player health (T0028)', () => {
  it('starts full, drops in a hard crash and comes back after a while unhurt', async () => {
    const { h, car } = await setup('sports');
    h.wall(0, 60, 10, 0.5);
    h.run(1);
    expect(playerHp(h)).toBe(PLAYER_MAX_HP);
    accelerateTo(h, car, 25);
    h.input.set(0, 1, 0);
    h.run(1.5);
    const hurt = playerHp(h);
    const carDamage = h.world.require(car, Vehicle).maxHealth - h.world.require(car, Vehicle).health;
    expect(carDamage).toBeGreaterThan(0);
    expect(hurt).toBeLessThan(PLAYER_MAX_HP);
    expect(hurt).toBeGreaterThan(0);
    h.run(REGEN_DELAY - 2);
    expect(playerHp(h)).toBeCloseTo(hurt, 5);
    h.run(60);
    expect(playerHp(h)).toBe(PLAYER_MAX_HP);
    h.dispose();
  });

  it('the HUD reader reports health and stars', async () => {
    const { h, car } = await setup();
    const read = createHudReader(h.world);
    h.run(1);
    expect(read().status).toEqual({
      health: 1,
      armor: 0,
      wanted: 0,
      maxWanted: MAX_WANTED_STARS,
      wantedRevision: 0,
      wantedFading: false,
    });
    spawnVehicle(h.world, h.s, 'compact', 0, 0, 30, { headless: true, yaw: Math.PI / 2 });
    accelerateTo(h, car, 12);
    h.input.set(0, 0, 0);
    h.run(3);
    const s = read().status!;
    expect(s.wanted).toBe(1);
    expect(s.wantedRevision).toBe(1);
    expect(s.wantedFading).toBe(false);
    h.run(starDecayTime(1) - 3 - 2); // inside the last 4 s before the star goes
    expect(read().status!.wantedFading).toBe(true);
    h.dispose();
  });
});
