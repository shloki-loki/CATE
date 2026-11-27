import { CollisionGroup, type BodyDesc, type BodyHandle, type PhysicsAPI } from '../../physics';
import type { CityData } from './generateCity';

/** Height of the invisible walls at the edge of the land (keeps cars out of the sea). */
export const EDGE_WALL_HEIGHT = 6;

/**
 * Static physics for the city, as plain body descriptions (T0018 §4 step 11: one box per
 * building tier, no trimeshes):
 * - one ground slab under the whole land, top at y = 0;
 * - one box per raised piece (blocks, parks, walkways), from 0 to the kerb height, so
 *   kerbs are real steps for wheels and feet;
 * - one body per building with a box per tier;
 * - four invisible walls along the shore.
 */
export function cityColliderDescs(city: CityData): BodyDesc[] {
  const out: BodyDesc[] = [];
  const b = city.bounds;
  out.push({
    type: 'static',
    position: { x: b.x, y: -0.5, z: b.z },
    shapes: [{ kind: 'box', halfExtents: { x: b.w / 2, y: 0.5, z: b.d / 2 } }],
    group: CollisionGroup.WORLD_STATIC,
    friction: 0.9,
  });
  for (const s of city.surfaces) {
    if (s.top <= 0) continue;
    out.push({
      type: 'static',
      position: { x: s.x, y: s.top / 2, z: s.z },
      shapes: [{ kind: 'box', halfExtents: { x: s.w / 2, y: s.top / 2, z: s.d / 2 } }],
      group: CollisionGroup.WORLD_STATIC,
      friction: 0.9,
    });
  }
  for (const bd of city.buildings) {
    out.push({
      type: 'static',
      position: { x: bd.x, y: bd.baseY, z: bd.z },
      shapes: bd.tiers.map((t) => ({
        kind: 'box' as const,
        halfExtents: { x: t.w / 2, y: (t.y1 - t.y0) / 2, z: t.d / 2 },
        offset: { x: t.x - bd.x, y: (t.y0 + t.y1) / 2 - bd.baseY, z: t.z - bd.z },
      })),
      group: CollisionGroup.WORLD_STATIC,
    });
  }
  const h = EDGE_WALL_HEIGHT / 2;
  const t = 0.5;
  const x0 = b.x - b.w / 2;
  const x1 = b.x + b.w / 2;
  const z0 = b.z - b.d / 2;
  const z1 = b.z + b.d / 2;
  const wall = (x: number, z: number, hx: number, hz: number): void => {
    out.push({
      type: 'static',
      position: { x, y: h, z },
      shapes: [{ kind: 'box', halfExtents: { x: hx, y: h, z: hz } }],
      group: CollisionGroup.WORLD_STATIC,
    });
  };
  wall(b.x, z0 - t, b.w / 2 + 2 * t, t);
  wall(b.x, z1 + t, b.w / 2 + 2 * t, t);
  wall(x0 - t, b.z, t, b.d / 2);
  wall(x1 + t, b.z, t, b.d / 2);
  return out;
}

export function createCityColliders(physics: PhysicsAPI, city: CityData): BodyHandle[] {
  return cityColliderDescs(city).map((d) => physics.createBody(d));
}
