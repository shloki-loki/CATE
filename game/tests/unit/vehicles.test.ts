import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  despawnVehicle,
  RigidBody,
  spawnVehicle,
  Transform,
  Vehicle,
  VehicleParts,
  VehicleTelemetry,
  type GameEvents,
} from '../../src/game';
import { CollisionGroup } from '../../src/physics';
import { createHarness, heading, pos, upY, type Harness } from './vehicleHarness';

/**
 * Headless vehicle tests: the real Rapier WASM, the real ECS systems, scripted input.
 * These cover the T0020 checks: the vehicle responds to input, collision detection
 * works, and the physics is stable.
 */
const KMH100 = 100 / 3.6;

async function withCar(defId = 'sedan', x = 0, z = 0, yaw = 0): Promise<{ h: Harness; e: number }> {
  const h = await createHarness();
  const e = spawnVehicle(h.world, h.s, defId, x, 0, z, { driver: 'player', headless: true, yaw });
  return { h, e };
}

function tel(h: Harness, e: number) {
  return h.world.require(e, VehicleTelemetry);
}

/** Full throttle until `speed` (m/s) or `maxSeconds`; returns seconds taken (Infinity if not reached). */
function accelerateTo(h: Harness, e: number, speed: number, maxSeconds = 30): number {
  h.input.set(1, 0, 0);
  for (let i = 0; i < maxSeconds * 60; i++) {
    if (tel(h, e).speed >= speed) return i / 60;
    h.run(1 / 60);
  }
  return Infinity;
}

describe('vehicle responds to input', () => {
  it('sits still with no input, then accelerates forward (+Z) on throttle', async () => {
    const { h, e } = await withCar();
    h.run(2);
    const p0 = pos(h, e);
    h.run(3);
    expect(pos(h, e).distanceTo(p0)).toBeLessThan(0.02);
    expect(tel(h, e).wheelsInContact).toBe(4);

    h.input.set(1, 0, 0);
    h.run(3);
    const p1 = pos(h, e);
    expect(tel(h, e).speed).toBeGreaterThan(10);
    expect(p1.z - p0.z).toBeGreaterThan(12);
    expect(Math.abs(p1.x - p0.x)).toBeLessThan(0.2); // drives straight
    expect(tel(h, e).drive.gear).toBeGreaterThanOrEqual(1);
    h.dispose();
  });

  it('steers right and left in the expected direction', async () => {
    for (const [steer, sign] of [
      [1, -1],
      [-1, 1],
    ] as const) {
      const { h, e } = await withCar();
      accelerateTo(h, e, 12);
      const h0 = heading(h, e);
      h.input.set(0.4, 0, steer);
      h.run(1);
      const turned = heading(h, e) - h0;
      expect(Math.sign(turned)).toBe(sign); // heading = atan2(fwd.x, fwd.z); right turn => negative
      expect(Math.abs(turned)).toBeGreaterThan(0.4);
      h.dispose();
    }
  });

  it('brakes from 100 km/h to a stop in a realistic distance, then reverses on held brake', async () => {
    const { h, e } = await withCar();
    expect(accelerateTo(h, e, KMH100)).toBeLessThan(15);
    const z0 = pos(h, e).z;
    h.input.set(0, 1, 0);
    let t = 0;
    while (tel(h, e).speed > 0.2 && t < 10) {
      h.run(1 / 60);
      t += 1 / 60;
    }
    const dist = pos(h, e).z - z0;
    // Real cars: roughly 35-45 m from 100 km/h.
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(55);
    h.run(3); // keep holding brake: reverse
    expect(tel(h, e).drive.gear).toBe(-1);
    expect(tel(h, e).speed).toBeLessThan(-3);
    expect(tel(h, e).speed).toBeGreaterThan(-9); // reverse is limited to ~30 km/h
    h.dispose();
  });

  it('0-100 km/h times and top speeds are plausible for each class', async () => {
    const expected: Record<string, [number, number, number]> = {
      // [min 0-100 s, max 0-100 s, min top speed km/h]
      compact: [7, 13, 150],
      sedan: [6, 11, 170],
      sports: [3, 6, 230],
      van: [9, 16, 150],
      police: [4.5, 8, 190],
    };
    for (const [id, [lo, hi, top]] of Object.entries(expected)) {
      const { h, e } = await withCar(id);
      const t = accelerateTo(h, e, KMH100);
      expect(t, id).toBeGreaterThan(lo);
      expect(t, id).toBeLessThan(hi);
      h.run(30);
      expect(tel(h, e).speed * 3.6, id).toBeGreaterThan(top);
      expect(tel(h, e).speed * 3.6, id).toBeLessThan(330);
      h.dispose();
    }
  });

  it('the handbrake swings the tail round (much tighter turn than steering alone)', async () => {
    const turn = async (handbrake: boolean) => {
      const { h, e } = await withCar();
      accelerateTo(h, e, 20);
      const h0 = heading(h, e);
      h.input.set(0, 0, 1, handbrake);
      h.run(1.2);
      const r = Math.abs(heading(h, e) - h0);
      expect(upY(h, e)).toBeGreaterThan(0.9);
      h.dispose();
      return r;
    };
    expect(await turn(true)).toBeGreaterThan((await turn(false)) * 1.3);
  });

  it('R rights a car that is upside down', async () => {
    const { h, e } = await withCar();
    h.run(1);
    const body = h.world.require(e, RigidBody).handle;
    const flip = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
    h.physics.setTransform(body, { position: new Vector3(0, 1.5, 0), quaternion: flip });
    h.run(3);
    expect(upY(h, e)).toBeLessThan(-0.5);
    h.input.tap('reset');
    h.run(3);
    expect(upY(h, e)).toBeGreaterThan(0.99);
    expect(tel(h, e).wheelsInContact).toBe(4);
    h.dispose();
  });
});

describe('collision detection works', () => {
  it('a car driven into a wall stops at its face, reports the hit and takes damage', async () => {
    const { h, e } = await withCar('sedan', 0, 0);
    h.wall(0, 60, 10, 0.5); // face at z = 59.5
    accelerateTo(h, e, 15);
    h.input.set(0.3, 0, 0);
    let maxFront = -Infinity;
    h.run(6, () => {
      maxFront = Math.max(maxFront, pos(h, e).z + 4.8 / 2);
    });
    expect(maxFront).toBeLessThan(59.5 + 0.05); // no penetration
    expect(maxFront).toBeGreaterThan(59.3); // it did reach the wall
    const hits = h.events
      .filter((x) => x.type === 'collision')
      .map((x) => x.payload as GameEvents['collision']);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.a).toBe(e);
    expect(hits[0]!.b).toBeNull(); // static world
    expect(hits[0]!.impulse).toBeGreaterThan(5000);
    expect(hits[0]!.point!.z).toBeCloseTo(59.5, 0);
    const v = h.world.require(e, Vehicle);
    expect(v.health).toBeLessThan(v.maxHealth);
    expect(v.health).toBeGreaterThan(0);
    expect(h.events.some((x) => x.type === 'damage')).toBe(true);
    h.dispose();
  });

  it('pushing against a wall does not spam collision events or damage', async () => {
    const { h, e } = await withCar('sedan', 0, 52);
    h.wall(0, 60, 10, 0.5);
    h.input.set(1, 0, 0);
    h.run(2);
    h.events.length = 0;
    const hp = h.world.require(e, Vehicle).health;
    h.run(3);
    expect(h.events.filter((x) => x.type === 'collision').length).toBe(0);
    expect(h.world.require(e, Vehicle).health).toBe(hp);
    h.dispose();
  });

  it('does not tunnel through a thin wall at 216 km/h (CCD)', async () => {
    const { h, e } = await withCar('sports', 0, 0);
    h.wall(0, 200, 10, 0.1); // 20 cm wall, face at z = 199.9
    h.run(0.5);
    h.physics.setVelocity(h.world.require(e, RigidBody).handle, { x: 0, y: 0, z: 60 }, { x: 0, y: 0, z: 0 });
    h.input.set(1, 0, 0);
    let maxZ = -Infinity;
    h.run(5, () => {
      maxZ = Math.max(maxZ, pos(h, e).z);
    });
    expect(maxZ + 4.4 / 2).toBeLessThan(199.9 + 0.05);
    expect(h.world.require(e, Vehicle).health).toBeLessThan(200); // a 216 km/h crash nearly wrecks it
    h.dispose();
  });

  it('car-to-car: both cars get the event and damage, and the parked car is shoved', async () => {
    const { h, e } = await withCar('sedan', 0, 0);
    const parked = spawnVehicle(h.world, h.s, 'compact', 0, 0, 30, { headless: true, yaw: Math.PI / 2 });
    h.run(1);
    const p0 = pos(h, parked);
    accelerateTo(h, e, 12);
    h.input.set(0, 0, 0);
    h.run(4);
    const hits = h.events
      .filter((x) => x.type === 'collision')
      .map((x) => x.payload as GameEvents['collision']);
    expect(hits.some((c) => [c.a, c.b].includes(e) && [c.a, c.b].includes(parked))).toBe(true);
    expect(pos(h, parked).distanceTo(p0)).toBeGreaterThan(1);
    expect(h.world.require(e, Vehicle).health).toBeLessThan(h.world.require(e, Vehicle).maxHealth);
    expect(h.world.require(parked, Vehicle).health).toBeLessThan(h.world.require(parked, Vehicle).maxHealth);
    expect(upY(h, e)).toBeGreaterThan(0.9);
    expect(upY(h, parked)).toBeGreaterThan(0.9);
    h.dispose();
  });

  it('a wrecked car emits death and loses drive', async () => {
    const { h, e } = await withCar('compact');
    h.world.require(e, Vehicle).health = 1;
    h.wall(0, 40, 10, 0.5);
    accelerateTo(h, e, 12);
    h.run(3);
    expect(h.world.require(e, Vehicle).health).toBe(0);
    expect(h.events.some((x) => x.type === 'death')).toBe(true);
    const body = h.world.require(e, RigidBody).handle;
    h.physics.setTransform(body, { position: new Vector3(20, 0.1, 0), quaternion: new Quaternion() });
    h.physics.setVelocity(body, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    h.input.set(1, 0, 0);
    h.run(3);
    expect(tel(h, e).drive.wrecked).toBe(true);
    expect(Math.abs(tel(h, e).speed)).toBeLessThan(0.3);
    h.dispose();
  });
});

describe('physics stable', () => {
  it('rests without drift or jitter for 30 s, at the designed ride height', async () => {
    const { h, e } = await withCar();
    h.run(1);
    const p0 = pos(h, e);
    const last = p0.clone();
    let maxStep = 0;
    let maxHorizontal = 0;
    h.run(30, () => {
      const p = h.world.require(e, Transform).position;
      maxStep = Math.max(maxStep, p.distanceTo(last));
      last.copy(p);
      const v = tel(h, e).velocity;
      maxHorizontal = Math.max(maxHorizontal, Math.hypot(v.x, v.z));
    });
    expect(pos(h, e).distanceTo(p0)).toBeLessThan(0.01);
    // No visible jitter: under 1 mm of movement per tick. (Rapier reports a constant
    // ~-0.06 m/s vertical velocity at rest because the suspension impulse is applied
    // before the step and gravity during it; the body itself does not move.)
    expect(maxStep).toBeLessThan(0.001);
    expect(maxHorizontal).toBeLessThan(0.01);
    expect(Math.abs(pos(h, e).y)).toBeLessThan(0.03); // origin on the ground (sag compensated)
    expect(upY(h, e)).toBeGreaterThan(0.9999);
  });

  it('full-lock cornering at 100 km/h does not roll any car over', async () => {
    for (const id of ['compact', 'sedan', 'sports', 'van', 'police']) {
      const { h, e } = await withCar(id);
      accelerateTo(h, e, KMH100);
      let minUp = 1;
      h.input.set(1, 0, 1);
      h.run(4, () => {
        minUp = Math.min(minUp, upY(h, e));
      });
      expect(minUp, id).toBeGreaterThan(0.8);
      h.dispose();
    }
  });

  it('survives a ramp jump and kerbs, landing upright', async () => {
    const { h, e } = await withCar('sports');
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.25);
    h.physics.createBody({
      type: 'static',
      position: { x: 0, y: 0.6, z: 80 },
      rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      shapes: [{ kind: 'box', halfExtents: { x: 3, y: 0.5, z: 5 } }],
      group: CollisionGroup.WORLD_STATIC,
    });
    for (let z = 20; z < 60; z += 6)
      h.physics.createBody({
        type: 'static',
        position: { x: 0.8, y: 0.06, z },
        shapes: [{ kind: 'box', halfExtents: { x: 0.5, y: 0.06, z: 0.3 } }],
      });
    h.input.set(1, 0, 0);
    let maxY = 0;
    let air = 0;
    let minUp = 1;
    h.run(10, () => {
      maxY = Math.max(maxY, pos(h, e).y);
      if (tel(h, e).wheelsInContact === 0) air++;
      minUp = Math.min(minUp, upY(h, e));
    });
    h.input.set(0, 0, 0);
    h.run(5);
    expect(maxY).toBeGreaterThan(2); // it really jumped
    expect(air).toBeGreaterThan(30);
    expect(minUp).toBeGreaterThan(0.8);
    expect(upY(h, e)).toBeGreaterThan(0.999);
    expect(tel(h, e).wheelsInContact).toBe(4);
    h.dispose();
  });

  it('2 minutes of random driving among 5 cars and walls: finite, above ground, no runaway speeds', async () => {
    const h = await createHarness();
    const ids = ['compact', 'sedan', 'sports', 'van', 'police'];
    const cars = ids.map((id, i) =>
      spawnVehicle(h.world, h.s, id, (i - 2) * 6, 0, 0, {
        driver: i === 2 ? 'player' : 'none',
        headless: true,
      }),
    );
    for (const [x, z, hx, hz] of [
      [0, 70, 60, 1],
      [0, -70, 60, 1],
      [60, 0, 1, 70],
      [-60, 0, 1, 70],
    ] as const)
      h.wall(x, z, hx, hz);
    let seed = 12345;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let bad = 0;
    let minY = Infinity;
    let maxSpeed = 0;
    h.run(120, (i) => {
      if (i % 40 === 0) h.input.set(rnd() < 0.8 ? 1 : 0, rnd() < 0.2 ? 1 : 0, rnd() * 2 - 1, rnd() < 0.15);
      if (i % 600 === 599) h.input.tap('reset');
      for (const c of cars) {
        const p = h.world.require(c, Transform).position;
        if (!Number.isFinite(p.x + p.y + p.z)) bad++;
        minY = Math.min(minY, p.y);
        maxSpeed = Math.max(maxSpeed, tel(h, c).velocity.length());
      }
    });
    expect(bad).toBe(0);
    expect(minY).toBeGreaterThan(-0.3);
    expect(maxSpeed).toBeLessThan(90);
    for (const c of cars) {
      const p = h.world.require(c, Transform).position;
      expect(Math.abs(p.x)).toBeLessThan(60);
      expect(Math.abs(p.z)).toBeLessThan(70);
    }
    h.dispose();
  });
});

describe('vehicle entity plumbing', () => {
  it('wheel views follow steering, spin and suspension; brake lights light up', async () => {
    const h = await createHarness();
    const e = spawnVehicle(h.world, h.s, 'sedan', 0, 0, 0, { driver: 'player' });
    expect(h.render.added.length).toBe(1);
    const parts = h.world.require(e, VehicleParts);
    expect(parts.wheelPivots.map((p) => p.name)).toEqual(['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']);
    h.input.set(1, 0, 1);
    h.run(1);
    expect(parts.wheelPivots[0]!.rotation.y).toBeLessThan(-0.05);
    expect(parts.wheelPivots[2]!.rotation.y).toBe(0);
    expect(parts.wheelSpinners[2]!.rotation.x).toBeGreaterThan(1);
    expect(parts.brakeLights!.emissiveIntensity).toBeLessThan(1);
    h.input.set(0, 1, 0);
    h.run(0.2);
    expect(parts.brakeLights!.emissiveIntensity).toBeGreaterThan(1);
    h.dispose();
  });

  it('the chase camera sits behind the car and the spring arm keeps it out of walls', async () => {
    const { h, e } = await withCar('sedan', 0, 0);
    h.run(2);
    const cam = h.s.render.camera;
    expect(cam.position.z).toBeLessThan(pos(h, e).z - 4);
    expect(cam.position.y).toBeGreaterThan(1);
    h.wall(0, -3.5, 10, 0.25, 6); // wall just behind the car
    h.run(1);
    expect(cam.position.z).toBeGreaterThan(-3.25);
    h.dispose();
  });

  it('despawn removes the body, the vehicle controller and the view', async () => {
    const h = await createHarness();
    const before = h.physics.bodyCount;
    const e = spawnVehicle(h.world, h.s, 'van', 0, 0, 0);
    expect(h.physics.bodyCount).toBe(before + 1);
    expect(h.physics.vehicleCount).toBe(1);
    h.run(0.5);
    despawnVehicle(h.world, h.s, e);
    expect(h.physics.bodyCount).toBe(before);
    expect(h.physics.vehicleCount).toBe(0);
    expect(h.render.added.length).toBe(0);
    expect(h.world.isAlive(e)).toBe(false);
    h.run(0.5); // still steps fine
    h.dispose();
  });
});
