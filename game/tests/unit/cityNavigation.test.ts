/**
 * T0027: the city's streets are navigable.
 * - Vehicles: a real Rapier raycast car (T0020 sports car) with a simple autopilot drives the
 *   whole warm-up lap and a sample of side streets with the city's colliders loaded, without
 *   hitting anything.
 * - Characters: a Rapier kinematic character controller with T0026's settings (capsule
 *   r = 0.35 m, half height 0.55 m, step 0.45 m) steps up kerbs, walks the sidewalks and is
 *   stopped by building walls; and every sidewalk, road and alley is reachable on foot.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { CheckpointRun, despawnVehicle, spawnVehicle, WARMUP_LAP } from '../../src/game';
import {
  cityColliderDescs,
  generateCity,
  KERB_HEIGHT,
  rectInside,
  type CityData,
} from '../../src/game/world';
import { createHarness, heading, pos, upY, type Harness } from './vehicleHarness';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

async function cityHarness(city: CityData): Promise<Harness> {
  const h = await createHarness(1); // the harness's own ground is tiny; the city brings its slab
  for (const d of cityColliderDescs(city)) h.physics.createBody(d);
  return h;
}

interface DriveResult {
  reached: number;
  seconds: number;
  minUp: number;
  maxSpeed: number;
  collisions: number;
}

/**
 * Autopilot: steer at the next waypoint, about 50 km/h on straights, slow for the turn.
 * Steer +1 is right (it lowers the heading atan2(fwd.x, fwd.z)).
 */
function drive(
  h: Harness,
  car: number,
  waypoints: { x: number; z: number }[],
  radius: number,
  limit: number,
  each?: (p: { x: number; z: number }) => void,
): DriveResult {
  let idx = 0;
  let prev = pos(h, car);
  let speed = 0;
  let minUp = 1;
  let maxSpeed = 0;
  let t = 0;
  const before = h.events.filter((e) => e.type === 'collision').length;
  while (idx < waypoints.length && t < limit) {
    const p = pos(h, car);
    const wp = waypoints[idx]!;
    const dist = Math.hypot(wp.x - p.x, wp.z - p.z);
    if (dist < radius) {
      idx++;
      continue;
    }
    const err = wrap(Math.atan2(wp.x - p.x, wp.z - p.z) - heading(h, car));
    const next = waypoints[idx + 1];
    const turning = next !== undefined && dist < 40;
    const target = Math.abs(err) > 0.5 ? 5 : turning ? 8 : 14;
    h.input.set(speed < target ? 1 : 0, speed > target + 1.5 ? 1 : 0, Math.max(-1, Math.min(1, -err * 2.5)));
    h.run(0.1);
    t += 0.1;
    const q = pos(h, car);
    each?.(q);
    speed = Math.hypot(q.x - prev.x, q.z - prev.z) / 0.1;
    prev = q;
    maxSpeed = Math.max(maxSpeed, speed);
    minUp = Math.min(minUp, upY(h, car));
  }
  h.input.set(0, 0, 0);
  return {
    reached: idx,
    seconds: t,
    minUp,
    maxSpeed,
    collisions: h.events.filter((e) => e.type === 'collision').length - before,
  };
}

describe('vehicles can drive the city', () => {
  for (const seed of [1986, 2024]) {
    it(`a car drives the full warm-up lap without hitting anything (seed ${seed})`, async () => {
      const city = generateCity({ seed });
      const h = await cityHarness(city);
      const sp = city.spawnPoints.find((s) => s.kind === 'player')!;
      const car = spawnVehicle(h.world, h.s, 'sports', sp.x, 0, sp.z, { driver: 'player', yaw: sp.yaw });
      h.run(0.5);
      const run = new CheckpointRun({ ...WARMUP_LAP, checkpoints: city.lap });
      let passed = false;
      // The mission logic itself must see the lap completed from the car's real positions.
      const r = drive(h, car, city.lap, WARMUP_LAP.radius - 2, 240, (p) => {
        for (const ev of run.update(0.1, p)) if (ev.kind === 'passed') passed = true;
      });
      console.log(
        `seed ${seed}: lap ${r.reached}/${city.lap.length} checkpoints in ${r.seconds.toFixed(1)} s, ` +
          `top speed ${(r.maxSpeed * 3.6).toFixed(0)} km/h, min up.y ${r.minUp.toFixed(3)}, collisions ${r.collisions}`,
      );
      expect(r.reached).toBe(city.lap.length);
      expect(passed).toBe(true);
      expect(r.collisions).toBe(0);
      expect(r.minUp).toBeGreaterThan(0.9);
      expect(r.maxSpeed).toBeGreaterThan(10);
      h.dispose();
    }, 120_000);
  }

  it('a car drives the length of side streets (both directions) without hitting anything', async () => {
    const city = generateCity();
    const h = await cityHarness(city);
    const streets = city.roads.edges.filter((e) => e.kind === 'street');
    expect(streets.length).toBeGreaterThan(10);
    const sample = streets.filter((_, k) => k % Math.ceil(streets.length / 10) === 0);
    let driven = 0;
    for (const e of sample) {
      for (const [from, to] of [
        [e.a, e.b],
        [e.b, e.a],
      ] as const) {
        const a = city.roads.node(from);
        const b = city.roads.node(to);
        const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        // Start in the right-hand lane at the near junction's edge.
        const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
        const start = { x: a.x + right.x * 2.5, z: a.z + right.z * 2.5 };
        const end = { x: b.x + right.x * 2.5, z: b.z + right.z * 2.5 };
        const car = spawnVehicle(h.world, h.s, 'sedan', start.x, 0, start.z, { driver: 'player', yaw });
        h.run(0.3);
        const r = drive(h, car, [end], 4, 40);
        expect(r.reached, `street ${e.id} ${from}->${to}`).toBe(1);
        expect(r.collisions, `street ${e.id} ${from}->${to}`).toBe(0);
        expect(r.minUp).toBeGreaterThan(0.9);
        despawnVehicle(h.world, h.s, car);
        h.run(0.05);
        driven++;
      }
    }
    expect(driven).toBeGreaterThanOrEqual(20);
    h.dispose();
  }, 120_000);
});

describe('collision control', () => {
  it('driving into a building does register collisions (so "0 collisions" above means something)', async () => {
    const city = generateCity();
    const h = await cityHarness(city);
    const b = city.buildings.find((x) => x.style === 'downtown_tower') ?? city.buildings[0]!;
    // On the sidewalk south of the building, facing it.
    const car = spawnVehicle(h.world, h.s, 'sedan', b.x, KERB_HEIGHT, b.z + b.d / 2 + 6, {
      driver: 'player',
      yaw: Math.PI,
    });
    h.run(0.3);
    const r = drive(h, car, [{ x: b.x, z: b.z }], 1, 8);
    expect(r.reached).toBe(0);
    expect(r.collisions).toBeGreaterThan(0);
    expect(pos(h, car).z).toBeGreaterThan(b.z + b.d / 2);
    h.dispose();
  });
});

describe('characters can walk the city', () => {
  async function walker(city: CityData) {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    for (const d of cityColliderDescs(city)) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(d.position.x, d.position.y, d.position.z),
      );
      for (const s of d.shapes) {
        if (s.kind !== 'box') throw new Error('city colliders are boxes');
        const o = s.offset ?? { x: 0, y: 0, z: 0 };
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z).setTranslation(
            o.x,
            o.y,
            o.z,
          ),
          body,
        );
      }
    }
    // Same capsule and controller settings as T0026's player.
    const R = 0.35;
    const HH = 0.55;
    const ctl = world.createCharacterController(0.02);
    ctl.setUp({ x: 0, y: 1, z: 0 });
    ctl.setSlideEnabled(true);
    ctl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    ctl.enableAutostep(0.45, R * 0.5, false);
    ctl.enableSnapToGround(0.35);
    let body: RAPIER.RigidBody | null = null;
    let col: RAPIER.Collider | null = null;
    return {
      place(x: number, z: number, y: number) {
        if (body) world.removeRigidBody(body);
        body = world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HH + R + 0.03, z),
        );
        col = world.createCollider(RAPIER.ColliderDesc.capsule(HH, R), body);
        world.step();
      },
      /** Walk at `speed` m/s in direction (dx, dz) for `seconds`. */
      walk(dx: number, dz: number, seconds: number, speed = 4.6) {
        const n = Math.hypot(dx, dz);
        let vy = 0;
        for (let k = 0; k < Math.round(seconds * 60); k++) {
          vy = Math.max(vy - 9.81 / 60, -20);
          ctl.computeColliderMovement(col!, {
            x: ((dx / n) * speed) / 60,
            y: vy / 60,
            z: ((dz / n) * speed) / 60,
          });
          if (ctl.computedGrounded()) vy = 0;
          const m = ctl.computedMovement();
          const p = body!.translation();
          body!.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
          world.step();
        }
      },
      /** Feet position. */
      feet() {
        const p = body!.translation();
        return { x: p.x, y: p.y - HH - R, z: p.z };
      },
      dispose() {
        world.free();
      },
    };
  }

  it('steps up a kerb from the road, walks around a block on the sidewalk, and steps back down', async () => {
    const city = generateCity();
    const w = await walker(city);
    // A block whose south side has a kerb on a road.
    const block = city.surfaces.find((s) => s.kind === 'block' && s.kerbs!.s && s.w > 30)!;
    const z1 = block.z + block.d / 2;
    w.place(block.x, z1 + 3, 0); // on the road, 3 m south of the kerb
    w.walk(0, -1, 0.3);
    expect(w.feet().y).toBeCloseTo(0, 1);
    w.walk(0, -1, 1.2); // north, over the kerb, onto the sidewalk ring
    expect(w.feet().y).toBeGreaterThan(KERB_HEIGHT - 0.05);
    expect(w.feet().z).toBeLessThan(z1 - 0.5);
    // Along the sidewalk ring (1.5 m inside the kerb) to the east end of the block.
    const startX = w.feet().x;
    w.walk(1, 0, (block.w / 2 - 3) / 4.6);
    expect(w.feet().x - startX).toBeGreaterThan(block.w / 2 - 4);
    expect(w.feet().y).toBeGreaterThan(KERB_HEIGHT - 0.05);
    // Back down onto the road.
    w.walk(0, 1, 1.5);
    expect(w.feet().z).toBeGreaterThan(z1 + 1);
    expect(w.feet().y).toBeCloseTo(0, 1);
    w.dispose();
  });

  it('building walls stop the character', async () => {
    const city = generateCity();
    const w = await walker(city);
    for (const b of city.buildings.slice(0, 15)) {
      // Start on the sidewalk 4 m south of the building and walk north into it for 3 s.
      const z1 = b.z + b.d / 2;
      w.place(b.x, z1 + 2.5, KERB_HEIGHT);
      w.walk(0, -1, 3);
      expect(w.feet().z, b.id).toBeGreaterThan(z1 + 0.3); // stopped at the wall (capsule radius 0.35)
    }
    w.dispose();
  });

  it('every road, alley, junction and sidewalk is reachable on foot (0.5 m grid flood fill)', () => {
    for (const seed of [1986, 7, 99]) {
      const city = generateCity({ seed });
      const cell = 0.5;
      const R = 0.35;
      const b = city.bounds;
      const x0 = b.x - b.w / 2;
      const z0 = b.z - b.d / 2;
      const nx = Math.ceil(b.w / cell);
      const nz = Math.ceil(b.d / cell);
      const blocked = new Uint8Array(nx * nz);
      // Building footprints grown by the capsule radius are not walkable.
      for (const bd of city.buildings) {
        const ia = Math.max(0, Math.floor((bd.x - bd.w / 2 - R - x0) / cell));
        const ib = Math.min(nx - 1, Math.floor((bd.x + bd.w / 2 + R - x0) / cell));
        const ja = Math.max(0, Math.floor((bd.z - bd.d / 2 - R - z0) / cell));
        const jb = Math.min(nz - 1, Math.floor((bd.z + bd.d / 2 + R - z0) / cell));
        for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) blocked[j * nx + i] = 1;
      }
      const sp = city.spawnPoints[0]!;
      const start = Math.floor((sp.z - z0) / cell) * nx + Math.floor((sp.x - x0) / cell);
      expect(blocked[start]).toBe(0);
      const seen = new Uint8Array(nx * nz);
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const i = c % nx;
        const j = (c - i) / nx;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const k = jj * nx + ii;
          if (!seen[k] && !blocked[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      // Sample every walkable surface on a 2 m grid: each unblocked sample must be reached.
      let samples = 0;
      for (const s of city.surfaces) {
        if (!['road', 'junction', 'alley', 'walk', 'block', 'park'].includes(s.kind)) continue;
        for (let x = s.x - s.w / 2 + 0.6; x < s.x + s.w / 2; x += 2)
          for (let z = s.z - s.d / 2 + 0.6; z < s.z + s.d / 2; z += 2) {
            const k = Math.floor((z - z0) / cell) * nx + Math.floor((x - x0) / cell);
            if (blocked[k]) continue;
            samples++;
            if (!seen[k])
              throw new Error(`seed ${seed}: (${x.toFixed(1)}, ${z.toFixed(1)}) on ${s.kind} is unreachable`);
          }
      }
      expect(samples).toBeGreaterThan(10_000);
      // And the sidewalk ring of every block is free of buildings.
      for (const blk of city.blocks)
        for (const bd of city.buildings)
          if (rectInside(bd, blk)) expect(bd.x - bd.w / 2).toBeGreaterThan(blk.x - blk.w / 2 + 2.9);
    }
  });
});
