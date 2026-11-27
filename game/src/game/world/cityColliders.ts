import { CollisionGroup, type BodyHandle, type PhysicsAPI } from '../../physics';
import type { City } from './generateCity';
import { groundSize } from './cityMesher';

/** Static physics for the city: one ground slab (top at y = 0) and one box per building. */
export function createCityColliders(physics: PhysicsAPI, city: City): BodyHandle[] {
  const handles: BodyHandle[] = [];
  const half = groundSize(city) / 2;
  handles.push(
    physics.createBody({
      type: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      shapes: [{ kind: 'box', halfExtents: { x: half, y: 0.5, z: half } }],
      group: CollisionGroup.WORLD_STATIC,
      friction: 0.9,
    }),
  );
  for (const b of city.buildings) {
    handles.push(
      physics.createBody({
        type: 'static',
        position: { x: b.x, y: b.h / 2, z: b.z },
        shapes: [{ kind: 'box', halfExtents: { x: b.w / 2, y: b.h / 2, z: b.d / 2 } }],
        group: CollisionGroup.WORLD_STATIC,
      }),
    );
  }
  return handles;
}
