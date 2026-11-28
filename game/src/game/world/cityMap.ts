import type { MapRoad, MinimapMap } from '../../ui';
import type { CityData } from './generateCity';

/** Top-down layout for the HUD minimap, from the same data as the meshes and colliders. */
export function cityMinimap(city: CityData): MinimapMap {
  const b = city.bounds;
  const roads: MapRoad[] = city.roads.edges.map((e) => {
    const a = city.roads.node(e.a);
    const c = city.roads.node(e.b);
    return { ax: a.x, az: a.z, bx: c.x, bz: c.z, width: e.width };
  });
  // Alleys: the minimap draws square caps, so pull the ends in by half the width.
  for (const s of city.surfaces) {
    if (s.kind !== 'alley') continue;
    const w = s.alongX ? s.d : s.w;
    const h = (s.alongX ? s.w : s.d) / 2 - w / 2;
    roads.push(
      s.alongX
        ? { ax: s.x - h, az: s.z, bx: s.x + h, bz: s.z, width: w }
        : { ax: s.x, az: s.z - h, bx: s.x, bz: s.z + h, width: w },
    );
  }
  return {
    bounds: { minX: b.x - b.w / 2, minZ: b.z - b.d / 2, maxX: b.x + b.w / 2, maxZ: b.z + b.d / 2 },
    outside: 'water',
    areas: city.surfaces
      .filter((s) => s.kind === 'sand' || s.kind === 'park')
      .map((s) => ({ kind: s.kind === 'sand' ? 'sand' : 'park', x: s.x, z: s.z, w: s.w, d: s.d })),
    roads,
    buildings: city.buildings.map((bd) => ({ x: bd.x, z: bd.z, w: bd.w, d: bd.d })),
  };
}
