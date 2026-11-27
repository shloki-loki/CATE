import type { Services } from '../../services';
import { createCityColliders } from './cityColliders';
import { buildCityMesh } from './cityMesher';
import { generateCity, type City, type CityOptions } from './generateCity';

export interface LoadedCity {
  city: City;
  bodies: number;
}

/** Generates the city and loads it into the engine: meshes into the render world, colliders into physics. */
export function loadCity(s: Services, options: Partial<CityOptions> = {}): LoadedCity {
  const city = generateCity(options);
  s.render.addToWorld(buildCityMesh(city), 'static');
  const bodies = createCityColliders(s.physics, city).length;
  return { city, bodies };
}
