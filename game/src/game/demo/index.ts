import { Euler, Quaternion } from 'three';
import type { Entity } from '../../core';
import type { GameWorld, Services } from '../../services';
import { CollisionGroup } from '../../physics';
import { makeTransform, PrevTransform, RigidBody, Transform, View } from '../components';
import { buildingView, crateView, groundView, palmView, roadView } from './demoView';
import { createPlayground } from './playground';

/** Small seeded PRNG (mulberry32) so the demo scene is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLD_SIZE = 400;
const ROAD_WIDTH = 12;
const BLOCK = 36;

export interface DemoScene {
  dynamic: Entity[];
  buildings: number;
  /** Static bodies of the on-foot playground next to the spawn. */
  playground: number;
  /** Where the player starts (capsule centre) and which way they face. */
  playerSpawn: { x: number; y: number; z: number };
  playerYaw: number;
}

/**
 * Player spawn: on the avenue's west edge, beside the driver door of the sports car that
 * main.ts parks at (-3, 0, 45) facing -Z, so F gets straight in. Faces -Z (the crossing).
 */
const SPAWN = { x: -5.2, z: 45.5 };
/** On-foot test playground on the open grass east of the city. */
const PLAYGROUND = { x: 100, z: 58 };

/**
 * The skeleton's minimal playable scene: ground, a road cross, a beach, placeholder
 * buildings with colliders, palms, and a few dynamic crates that fall and settle
 * (to prove physics, interpolation and rendering are wired together). Vehicles are
 * spawned by main.ts through game/vehicles (T0020).
 * T0022 replaces this with the procedural city.
 */
export function createDemoScene(world: GameWorld, s: Services, seed = 1986): DemoScene {
  const rand = mulberry32(seed);
  const half = WORLD_SIZE / 2;

  // Ground: one static box collider, top surface at y = 0.
  s.physics.createBody({
    type: 'static',
    position: { x: 0, y: -0.5, z: 0 },
    shapes: [{ kind: 'box', halfExtents: { x: half, y: 0.5, z: half } }],
    group: CollisionGroup.WORLD_STATIC,
    friction: 0.9,
  });
  s.render.addToWorld(groundView(WORLD_SIZE), 'static');

  // Roads every 2 blocks in both directions.
  const step = BLOCK * 2 + ROAD_WIDTH;
  const roadLines = [-step, 0, step];
  for (const c of roadLines) {
    const rx = roadView(WORLD_SIZE - 60, ROAD_WIDTH, true);
    rx.position.set(-30, 0, c);
    const rz = roadView(WORLD_SIZE, ROAD_WIDTH, false);
    rz.position.set(c, 0.001, 0);
    s.render.addToWorld(rx, 'static');
    s.render.addToWorld(rz, 'static');
  }

  // Buildings fill the blocks between roads (west of the beach).
  let buildings = 0;
  const cells = [-1.5, -0.5, 0.5, 1.5].map((k) => k * step);
  for (const cx of cells) {
    for (const cz of cells) {
      if (cx > half - 90) continue; // keep the east side and beach clear
      for (const [ox, oz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        if (rand() < 0.18) continue; // leave some lots empty
        const w = 14 + rand() * 12;
        const d = 14 + rand() * 12;
        const downtown = Math.hypot(cx, cz) < step;
        const h = downtown ? 25 + rand() * 55 : 7 + rand() * 18;
        const x = cx + ox * (BLOCK / 2 - 2);
        const z = cz + oz * (BLOCK / 2 - 2);
        s.physics.createBody({
          type: 'static',
          position: { x, y: h / 2, z },
          shapes: [{ kind: 'box', halfExtents: { x: w / 2, y: h / 2, z: d / 2 } }],
        });
        const v = buildingView(w, h, d, Math.floor(rand() * 6));
        v.position.set(x, 0, z);
        s.render.addToWorld(v, 'static');
        buildings++;
      }
    }
  }

  // Palms along the beach road.
  for (let z = -half + 10; z < half; z += 14) {
    const p = palmView(6 + rand() * 4);
    p.position.set(half - 64, 0, z + rand() * 4);
    s.render.addToWorld(p, 'static');
  }

  // Dynamic bodies near the central crossing: they fall, collide and settle.
  const dynamic: Entity[] = [];
  const tilt = new Quaternion();
  const euler = new Euler();
  const spawn = (
    view: ReturnType<typeof crateView>,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    density: number,
  ): Entity => {
    const e = world.createEntity();
    const handle = s.physics.createBody({
      type: 'dynamic',
      position: { x, y, z },
      rotation: tilt.setFromEuler(euler.set(rand() * 0.6, rand() * Math.PI, rand() * 0.6)),
      shapes: [{ kind: 'box', halfExtents: { x: hx, y: hy, z: hz } }],
      group: CollisionGroup.PROP,
      density,
      friction: 0.8,
    });
    const t = makeTransform(x, y, z);
    s.physics.getTransform(handle, t);
    world.add(e, Transform, t);
    world.add(e, PrevTransform, { position: t.position.clone(), quaternion: t.quaternion.clone() });
    world.add(e, RigidBody, { handle });
    world.add(e, View, { object3D: view });
    view.position.copy(t.position);
    view.quaternion.copy(t.quaternion);
    s.render.addToWorld(view, 'dynamic');
    dynamic.push(e);
    return e;
  };

  for (let i = 0; i < 10; i++) {
    const size = 1 + rand();
    spawn(
      crateView(size),
      (rand() - 0.5) * 10,
      6 + i * 2.5,
      (rand() - 0.5) * 10,
      size / 2,
      size / 2,
      size / 2,
      1,
    );
  }

  const playground = createPlayground(s, PLAYGROUND.x, PLAYGROUND.z);
  // Light crates to push around next to the playground.
  for (let i = 0; i < 4; i++) {
    const size = 0.8 + rand() * 0.4;
    spawn(
      crateView(size),
      PLAYGROUND.x - 6 + i * 1.6,
      0.6 + size / 2,
      PLAYGROUND.z + 2,
      size / 2,
      size / 2,
      size / 2,
      0.4,
    );
  }

  return {
    dynamic,
    buildings,
    playground,
    playerSpawn: { x: SPAWN.x, y: 0.95, z: SPAWN.z },
    playerYaw: 0,
  };
}
