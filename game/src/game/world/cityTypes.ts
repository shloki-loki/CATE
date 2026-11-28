/**
 * Plain, JSON-serialisable city data (T0016 §4.3 `CityData`) and the T0018 §8 naming
 * rules for everything the city produces. No Three.js and no physics in here.
 *
 * Axes: +X east, -Z north, +Y up, 1 unit = 1 metre. The sea is to the east.
 */

/** Axis-aligned rectangle on the ground plane: centre and full size along X (w) and Z (d). */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Height of sidewalks, blocks and walkways above the road (T0018 §4: kerb strips 0.15 m). */
export const KERB_HEIGHT = 0.15;

/** T0016 §4.2: the world is split into 256 m x 256 m chunks. */
export const CHUNK_SIZE = 256;

/** Districts (T0016 §4.2, invented names only). */
export type District = 'downtown' | 'beach' | 'res' | 'ind';

/** Building styles from T0018 §2.1 (`<district>_<style>`). The airport styles are not used yet. */
export const BUILDING_STYLES = [
  'downtown_tower',
  'downtown_office',
  'beach_hotel',
  'beach_shop',
  'res_house',
  'res_lowrise',
  'ind_warehouse',
] as const;
export type BuildingStyle = (typeof BUILDING_STYLES)[number];

/** One stacked box of a building (podium, tower, setback). `y0`/`y1` are absolute heights. */
export interface Tier extends Rect {
  y0: number;
  y1: number;
}

export type RoofKind = 'flat' | 'hip' | 'gable';

export interface Building {
  /** `b_<chunkX>_<chunkZ>_<index>` (T0018 §8.1). */
  id: string;
  /** `c_<x>_<z>` of the chunk that holds the footprint centre. */
  chunk: string;
  style: BuildingStyle;
  district: District;
  /** Footprint (the lowest tier). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Bottom of the walls (top of the sidewalk). */
  baseY: number;
  /** Top of the walls of the highest tier (roof structures such as a hip roof sit above). */
  height: number;
  floors: number;
  /** Height of the ground floor and of each upper floor, metres (T0018 §4 step 2). */
  groundHeight: number;
  floorHeight: number;
  tiers: Tier[];
  roof: RoofKind;
  /** Height of a hip or gable roof above the top tier (0 for flat roofs). */
  roofHeight: number;
  /** Wall colour (0xRRGGBB) and roof colour. */
  tint: number;
  roofTint: number;
  /** Window layout: continuous ribbon or bays of this width in metres. */
  windows: 'ribbon' | 'bays' | 'high';
  /** Per-building seed for facade details. */
  seed: number;
}

/**
 * Every ground-level piece of the city. Together the surfaces tile the land exactly:
 * no two overlap and there are no gaps (tested), so nothing is drawn twice.
 */
export type SurfaceKind =
  | 'junction' // asphalt square where road lines cross
  | 'road' // asphalt corridor with lane markings
  | 'alley' // narrow asphalt lane where a street was dropped
  | 'walk' // raised sidewalk beside an alley
  | 'block' // raised sidewalk block that buildings stand on
  | 'park' // raised block with a grass centre
  | 'grass' // open land around the city
  | 'sand'; // beach

export interface Surface extends Rect {
  kind: SurfaceKind;
  /** Height of the top face: 0 for roads and land, KERB_HEIGHT for raised pieces. */
  top: number;
  /** For raised pieces: which sides need a kerb face down to the road (N = -Z, S = +Z, W = -X, E = +X). */
  kerbs?: { n: boolean; s: boolean; w: boolean; e: boolean };
  /** For roads: runs along X (constant z) or along Z. */
  alongX?: boolean;
  /** For roads: arterial (4 lanes, double yellow centre line) or street (2 lanes, dashed). */
  arterial?: boolean;
  chunk: string;
}

export interface SpawnPoint {
  kind: 'player' | 'parked';
  x: number;
  z: number;
  /** Rotation about +Y; 0 faces +Z, PI faces -Z (north). */
  yaw: number;
  /** Suggested vehicle for this spot. */
  vehicle: 'sports' | 'sedan' | 'compact' | 'van' | 'police';
}

export interface Zone extends Rect {
  district: District;
}

/** Ids, materials and node names produced by the city (T0018 §8). */
export const CITY_NAMES = {
  chunk: /^c_-?\d+_-?\d+$/,
  building: /^b_-?\d+_-?\d+_\d+$/,
  material: /^mat_(asphalt|sidewalk|kerb|sand|grass|water|roof|facade_[a-z]+_[a-z]+)$/,
  /** Plain lowercase mesh part names (T0018 §8.2). */
  part: /^[a-z][a-z0-9_]*$/,
};

export function chunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

export function chunkId(x: number, z: number): string {
  return `c_${chunkCoord(x)}_${chunkCoord(z)}`;
}

export function rectsOverlap(p: Rect, q: Rect, margin = 0): boolean {
  return (
    Math.abs(p.x - q.x) < (p.w + q.w) / 2 + margin - 1e-9 &&
    Math.abs(p.z - q.z) < (p.d + q.d) / 2 + margin - 1e-9
  );
}

/** True when `inner` lies inside `outer` (within `eps` metres). */
export function rectInside(inner: Rect, outer: Rect, eps = 1e-6): boolean {
  return (
    inner.x - inner.w / 2 >= outer.x - outer.w / 2 - eps &&
    inner.x + inner.w / 2 <= outer.x + outer.w / 2 + eps &&
    inner.z - inner.d / 2 >= outer.z - outer.d / 2 - eps &&
    inner.z + inner.d / 2 <= outer.z + outer.d / 2 + eps
  );
}

/** Rect from edges (min/max corners). */
export function rectFromEdges(x0: number, z0: number, x1: number, z1: number): Rect {
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}
