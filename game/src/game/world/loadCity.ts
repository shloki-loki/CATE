import type { Group } from 'three';
import type { BodyHandle } from '../../physics';
import type { Services } from '../../services';
import { createCityColliders } from './cityColliders';
import { buildCityMesh, disposeCityObject } from './cityMesher';
import { generateCity, type CityData, type CityOptions } from './generateCity';

export interface LoadedCity {
  city: CityData;
  root: Group;
  bodies: BodyHandle[];
  /** Milliseconds spent generating data, building meshes and creating colliders. */
  timings: { generate: number; mesh: number; colliders: number; total: number };
  /** Removes the meshes and colliders again and frees the geometry. */
  unload(): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Generates the city (or takes a generated one) and loads it: meshes into the render world, colliders into physics. */
export function loadCity(s: Services, from: CityData | Partial<CityOptions> = {}): LoadedCity {
  const t0 = now();
  const city = 'surfaces' in from ? from : generateCity(from);
  const t1 = now();
  const root = buildCityMesh(city);
  s.render.addToWorld(root, 'static');
  const t2 = now();
  const bodies = createCityColliders(s.physics, city);
  const t3 = now();
  return {
    city,
    root,
    bodies,
    timings: { generate: t1 - t0, mesh: t2 - t1, colliders: t3 - t2, total: t3 - t0 },
    unload() {
      s.render.remove(root);
      disposeCityObject(root);
      for (const b of bodies) s.physics.removeBody(b);
    },
  };
}
