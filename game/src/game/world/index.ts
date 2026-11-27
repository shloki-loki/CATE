// Procedural city (T0022/T0027): generateCity (pure CityData), RoadGraph, cityMesher (runtime
// meshes merged per chunk and material), cityColliders, cityMinimap, glTF export, loadCity.
// ChunkStreamer is a later step: the whole city (about 0.6 km across) loads at once.
export {
  generateCity,
  DEFAULT_CITY,
  ARTERIAL_WIDTH,
  STREET_WIDTH,
  ALLEY_WIDTH,
  SIDEWALK_WIDTH,
} from './generateCity';
export type { Block, CityData, CityOptions } from './generateCity';
export {
  BUILDING_STYLES,
  CHUNK_SIZE,
  CITY_NAMES,
  KERB_HEIGHT,
  chunkCoord,
  chunkId,
  rectInside,
  rectsOverlap,
} from './cityTypes';
export type {
  Building,
  BuildingStyle,
  District,
  Rect,
  RoofKind,
  SpawnPoint,
  Surface,
  SurfaceKind,
  Tier,
  Zone,
} from './cityTypes';
export { RoadGraph } from './roadGraph';
export type { RoadEdge, RoadKind, RoadNode } from './roadGraph';
export { cityColliderDescs, createCityColliders, EDGE_WALL_HEIGHT } from './cityColliders';
export {
  buildCityExportScene,
  buildCityMesh,
  buildCityObject,
  cityMaterials,
  disposeCityObject,
  partName,
  SEA_LEVEL,
} from './cityMesher';
export { cityMinimap } from './cityMap';
export { exportCityGlb } from './exportCity';
export { loadCity } from './loadCity';
export type { LoadedCity } from './loadCity';
export { mulberry32 } from './rng';
