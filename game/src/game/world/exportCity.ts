import { exportGlb } from '../../assets';
import { buildCityExportScene, disposeCityObject } from './cityMesher';
import type { CityData } from './generateCity';

/**
 * The city as one binary glTF 2.0 file, for the asset pipeline (T0018): root node `city`,
 * chunk nodes `c_<x>_<z>`, one mesh node per building `b_<chunkX>_<chunkZ>_<index>` with
 * materials `mat_facade_<style>` and `mat_roof`, and merged ground meshes per chunk
 * (`road`, `sidewalk`, `kerb`, `grass`, `sand`), plus `shore` and `sea`.
 * Building nodes carry `{style, district, floors, height}` in glTF `extras`.
 */
export async function exportCityGlb(city: CityData): Promise<ArrayBuffer> {
  const scene = buildCityExportScene(city);
  try {
    return await exportGlb(scene);
  } finally {
    disposeCityObject(scene);
  }
}
