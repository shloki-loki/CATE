import {
  chunkCoord,
  chunkId,
  KERB_HEIGHT,
  rectFromEdges,
  type Building,
  type BuildingStyle,
  type District,
  type Rect,
  type RoofKind,
  type SpawnPoint,
  type Surface,
  type Tier,
  type Zone,
} from './cityTypes';
import { mulberry32 } from './rng';
import { RoadGraph } from './roadGraph';

export interface CityOptions {
  seed: number;
  /** Road lines per side (>= 5). Lines 0, n-1 and every third line are arterials. */
  gridSize: number;
  /** Mean distance between road lines, metres (>= 45). */
  spacing: number;
  /** Chance that a street segment that is not needed for connectivity becomes an alley. */
  dropChance: number;
}

export const DEFAULT_CITY: CityOptions = { seed: 1986, gridSize: 8, spacing: 64, dropChance: 0.2 };

export const ARTERIAL_WIDTH = 16;
export const STREET_WIDTH = 11;
export const ALLEY_WIDTH = 5;
/** Sidewalk ring inside every block, between the kerb and the building lots. */
export const SIDEWALK_WIDTH = 3;
/** Open land around the city on the north, west and south sides. */
const LAND_MARGIN = 40;
/** Grass strip between the city and the beach, then the beach itself (east side). */
const SHORE_GRASS = 12;
const BEACH_WIDTH = 60;
/** How far the sea reaches beyond the land. */
const SEA_REACH = 1600;

export interface Block extends Rect {
  /** Grid cell (column i between lines i and i+1, row j). */
  i: number;
  j: number;
  district: District;
  park: boolean;
}

/** Everything the renderer, physics, minimap and missions need. Pure data, deterministic per seed. */
export interface CityData {
  options: CityOptions;
  seed: number;
  /** The land (city, open land, beach). The sea surrounds it. */
  bounds: Rect;
  /** The road grid: outer edges of the outer ring roads. */
  core: Rect;
  /** Road line positions and widths: vertical lines at x = xs[i], horizontal at z = zs[j]. */
  lines: { xs: number[]; zs: number[]; widthX: number[]; widthZ: number[] };
  roads: RoadGraph;
  blocks: Block[];
  surfaces: Surface[];
  /** Sea rectangles around the land (water level below the land). */
  sea: Rect[];
  buildings: Building[];
  spawnPoints: SpawnPoint[];
  /** Warm-up lap checkpoints: junctions on arterials, starting straight ahead of the player spawn. */
  lap: { x: number; z: number }[];
  zones: Zone[];
  /** Every chunk id that holds part of the city. */
  chunks: string[];
}

/** Union-find used to keep the road network connected while dropping streets. */
class Dsu {
  private readonly p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]!]!;
      x = this.p[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    this.p[this.find(a)] = this.find(b);
  }
}

interface Seg {
  a: number;
  b: number;
  /** 'h' runs along X on row j between columns i and i+1; 'v' runs along Z on column i. */
  dir: 'h' | 'v';
  i: number;
  j: number;
  arterial: boolean;
}

const PALETTES: Record<BuildingStyle, number[]> = {
  downtown_tower: [0xd9d6cf, 0xbfc7cc, 0xe8e2d4, 0xa9b4bb, 0xf1efe9, 0xc9bfae],
  downtown_office: [0xe3d9c6, 0xcfd5d8, 0xf0e6d8, 0xb8c2c4, 0xe9d7c3],
  beach_hotel: [0xf6c1d0, 0x9ee6e0, 0xfbe3a1, 0xffffff, 0xc7b8f5, 0xffcfa8],
  beach_shop: [0xffb38a, 0x8fd6f0, 0xf7a6c8, 0xfff0b3, 0xa8e6cf],
  res_house: [0xf3e1c7, 0xe9c9b5, 0xd8e8d0, 0xf5f0e1, 0xcfe0ee, 0xf2d4dc],
  res_lowrise: [0xefe2cc, 0xd6cbbd, 0xe7d3c9, 0xd5e2dd, 0xf0e8dc],
  ind_warehouse: [0xa9b0b5, 0xb8b2a6, 0x9aa7ae, 0xc2bcb0],
};

/**
 * Procedural city (pure and deterministic for a seed).
 *
 * 1. Road lines: n x n irregularly spaced lines; the outer ring and every third line are
 *    16 m arterials, the rest 11 m streets.
 * 2. Streets: segments are visited in random order. A segment that joins two separate parts
 *    of the network is always kept (so the network is connected); others become alleys with
 *    probability `dropChance`. Arterials are always kept.
 * 3. Surfaces: every junction, road corridor and block is a rectangle, and together with the
 *    land ring and beach they tile the land exactly (no overlaps, no gaps).
 * 4. Buildings: each block is split into lots; each lot gets a building in its district's
 *    style (T0018 §2.1), with floors, setbacks and roofs. Footprints never overlap.
 */
export function generateCity(partial: Partial<CityOptions> = {}): CityData {
  const o: CityOptions = { ...DEFAULT_CITY, ...partial };
  if (!Number.isInteger(o.gridSize) || o.gridSize < 5)
    throw new Error('generateCity: gridSize must be an integer >= 5');
  if (!(o.spacing >= 45)) throw new Error('generateCity: spacing must be >= 45');
  const rand = mulberry32(o.seed);
  const n = o.gridSize;
  const isArterial = (k: number): boolean => k === 0 || k === n - 1 || k % 3 === 0;

  // 1. Irregular, centred road lines.
  const line = (): number[] => {
    const pos = [0];
    for (let k = 1; k < n; k++) pos.push(pos[k - 1]! + o.spacing * (0.8 + rand() * 0.4));
    const mid = (pos[0]! + pos[n - 1]!) / 2;
    return pos.map((p) => Math.round((p - mid) * 2) / 2);
  };
  const xs = line();
  const zs = line();
  const widthOf = (k: number): number => (isArterial(k) ? ARTERIAL_WIDTH : STREET_WIDTH);
  const widthX = xs.map((_, k) => widthOf(k));
  const widthZ = zs.map((_, k) => widthOf(k));

  // 2. Road network.
  const roads = new RoadGraph();
  const node = (i: number, j: number): number => j * n + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) roads.addNode(xs[i]!, zs[j]!);
  const segs: Seg[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (i + 1 < n) segs.push({ a: node(i, j), b: node(i + 1, j), dir: 'h', i, j, arterial: isArterial(j) });
      if (j + 1 < n) segs.push({ a: node(i, j), b: node(i, j + 1), dir: 'v', i, j, arterial: isArterial(i) });
    }
  const key = (dir: 'h' | 'v', i: number, j: number): string => `${dir}${i},${j}`;
  const dsu = new Dsu(n * n);
  const kept = new Set<string>();
  const keep = (s: Seg): void => {
    kept.add(key(s.dir, s.i, s.j));
    dsu.union(s.a, s.b);
  };
  for (const s of segs) if (s.arterial) keep(s);
  const rest = segs.filter((s) => !s.arterial);
  for (let k = rest.length - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1));
    [rest[k], rest[r]] = [rest[r]!, rest[k]!];
  }
  for (const s of rest) if (dsu.find(s.a) !== dsu.find(s.b) || rand() >= o.dropChance) keep(s);
  for (const s of segs)
    if (kept.has(key(s.dir, s.i, s.j)))
      roads.addEdge(s.a, s.b, s.arterial ? 'arterial' : 'street', s.arterial ? ARTERIAL_WIDTH : STREET_WIDTH);
  if (!roads.isConnected()) throw new Error('generateCity: road network is not connected');
  const isKept = (dir: 'h' | 'v', i: number, j: number): boolean => kept.has(key(dir, i, j));

  // 3. Surfaces of the road grid: junctions, corridors (road or alley + walkways), blocks.
  const surfaces: Surface[] = [];
  const surf = (s: Omit<Surface, 'chunk'>): void => {
    if (s.w > 1e-6 && s.d > 1e-6) surfaces.push({ ...s, chunk: chunkId(s.x, s.z) });
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      surf({ kind: 'junction', top: 0, x: xs[i]!, z: zs[j]!, w: widthX[i]!, d: widthZ[j]! });

  const half = ALLEY_WIDTH / 2;
  for (const s of segs) {
    const along = s.dir === 'h';
    // Corridor between the two junction squares.
    const r = along
      ? rectFromEdges(
          xs[s.i]! + widthX[s.i]! / 2,
          zs[s.j]! - widthZ[s.j]! / 2,
          xs[s.i + 1]! - widthX[s.i + 1]! / 2,
          zs[s.j]! + widthZ[s.j]! / 2,
        )
      : rectFromEdges(
          xs[s.i]! - widthX[s.i]! / 2,
          zs[s.j]! + widthZ[s.j]! / 2,
          xs[s.i]! + widthX[s.i]! / 2,
          zs[s.j + 1]! - widthZ[s.j + 1]! / 2,
        );
    if (isKept(s.dir, s.i, s.j)) {
      surf({ kind: 'road', top: 0, ...r, alongX: along, arterial: s.arterial });
      continue;
    }
    // Dropped street: a 5 m alley in the middle and a raised walkway on each side.
    if (along) {
      const z0 = r.z - r.d / 2;
      const z1 = r.z + r.d / 2;
      const x0 = r.x - r.w / 2;
      const x1 = r.x + r.w / 2;
      surf({ kind: 'alley', top: 0, ...rectFromEdges(x0, r.z - half, x1, r.z + half), alongX: true });
      surf({
        kind: 'walk',
        top: KERB_HEIGHT,
        ...rectFromEdges(x0, z0, x1, r.z - half),
        kerbs: { n: false, s: true, w: true, e: true },
      });
      surf({
        kind: 'walk',
        top: KERB_HEIGHT,
        ...rectFromEdges(x0, r.z + half, x1, z1),
        kerbs: { n: true, s: false, w: true, e: true },
      });
    } else {
      const z0 = r.z - r.d / 2;
      const z1 = r.z + r.d / 2;
      const x0 = r.x - r.w / 2;
      const x1 = r.x + r.w / 2;
      surf({ kind: 'alley', top: 0, ...rectFromEdges(r.x - half, z0, r.x + half, z1), alongX: false });
      surf({
        kind: 'walk',
        top: KERB_HEIGHT,
        ...rectFromEdges(x0, z0, r.x - half, z1),
        kerbs: { n: true, s: true, w: false, e: true },
      });
      surf({
        kind: 'walk',
        top: KERB_HEIGHT,
        ...rectFromEdges(r.x + half, z0, x1, z1),
        kerbs: { n: true, s: true, w: true, e: false },
      });
    }
  }

  const core = rectFromEdges(
    xs[0]! - widthX[0]! / 2,
    zs[0]! - widthZ[0]! / 2,
    xs[n - 1]! + widthX[n - 1]! / 2,
    zs[n - 1]! + widthZ[n - 1]! / 2,
  );
  const coreHalf = Math.max(core.w, core.d) / 2;

  // Blocks and their districts.
  const blocks: Block[] = [];
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const r = rectFromEdges(
        xs[i]! + widthX[i]! / 2,
        zs[j]! + widthZ[j]! / 2,
        xs[i + 1]! - widthX[i + 1]! / 2,
        zs[j + 1]! - widthZ[j + 1]! / 2,
      );
      const centrality = 1 - Math.min(1, Math.hypot(r.x - core.x, r.z - core.z) / coreHalf);
      const district: District =
        i === n - 2 ? 'beach' : centrality > 0.55 ? 'downtown' : i === 0 && r.z > core.z ? 'ind' : 'res';
      const park = district !== 'ind' && rand() < (district === 'downtown' ? 0.06 : 0.1);
      blocks.push({ ...r, i, j, district, park });
      surf({
        kind: park ? 'park' : 'block',
        top: KERB_HEIGHT,
        ...r,
        kerbs: {
          n: isKept('h', i, j),
          s: isKept('h', i, j + 1),
          w: isKept('v', i, j),
          e: isKept('v', i + 1, j),
        },
      });
    }

  // Land around the grid: grass on three sides, a grass strip and a beach on the east.
  const shore = core.x + core.w / 2 + SHORE_GRASS;
  const L = {
    x0: core.x - core.w / 2 - LAND_MARGIN,
    x1: shore + BEACH_WIDTH,
    z0: core.z - core.d / 2 - LAND_MARGIN,
    z1: core.z + core.d / 2 + LAND_MARGIN,
  };
  const cz0 = core.z - core.d / 2;
  const cz1 = core.z + core.d / 2;
  const cx0 = core.x - core.w / 2;
  const cx1 = core.x + core.w / 2;
  surf({ kind: 'grass', top: 0, ...rectFromEdges(L.x0, L.z0, shore, cz0) });
  surf({ kind: 'grass', top: 0, ...rectFromEdges(L.x0, cz1, shore, L.z1) });
  surf({ kind: 'grass', top: 0, ...rectFromEdges(L.x0, cz0, cx0, cz1) });
  surf({ kind: 'grass', top: 0, ...rectFromEdges(cx1, cz0, shore, cz1) });
  surf({ kind: 'sand', top: 0, ...rectFromEdges(shore, L.z0, L.x1, L.z1) });
  const bounds = rectFromEdges(L.x0, L.z0, L.x1, L.z1);
  const sea = [
    rectFromEdges(L.x0 - SEA_REACH, L.z0 - SEA_REACH, L.x1 + SEA_REACH, L.z0),
    rectFromEdges(L.x0 - SEA_REACH, L.z1, L.x1 + SEA_REACH, L.z1 + SEA_REACH),
    rectFromEdges(L.x0 - SEA_REACH, L.z0, L.x0, L.z1),
    rectFromEdges(L.x1, L.z0, L.x1 + SEA_REACH, L.z1),
  ];

  // 4. Buildings.
  const buildings: Building[] = [];
  const perChunk = new Map<string, number>();
  for (const b of blocks) {
    if (b.park) continue;
    const centrality = 1 - Math.min(1, Math.hypot(b.x - core.x, b.z - core.z) / coreHalf);
    const inner = { w: b.w - 2 * SIDEWALK_WIDTH, d: b.d - 2 * SIDEWALK_WIDTH };
    const lot = { downtown: 26, beach: 22, res: 15, ind: 32 }[b.district];
    const nx = Math.max(1, Math.round(inner.w / lot));
    const nz = Math.max(1, Math.round(inner.d / lot));
    const lw = inner.w / nx;
    const ld = inner.d / nz;
    for (let c = 0; c < nz; c++)
      for (let a = 0; a < nx; a++) {
        if (rand() < 0.07) continue; // empty lot (open sidewalk / plaza)
        const lotX = b.x - inner.w / 2 + lw * (a + 0.5);
        const lotZ = b.z - inner.d / 2 + ld * (c + 0.5);
        const style = pickStyle(b.district, Math.min(lw, ld), centrality, rand);
        // Gap to the lot edge: at least 0.75 m, so neighbours stay >= 1.5 m apart.
        let w = lw - 2 * (0.75 + rand() * 1.25);
        let d = ld - 2 * (0.75 + rand() * 1.25);
        if (style === 'res_house') {
          w = Math.min(w, 9 + rand() * 5);
          d = Math.min(d, 9 + rand() * 5);
        }
        if (w < 6 || d < 6) continue;
        // Shift within the lot, never past its edges.
        const x = lotX + (rand() - 0.5) * (lw - 1.5 - w);
        const z = lotZ + (rand() - 0.5) * (ld - 1.5 - d);
        const chunk = chunkId(x, z);
        const index = perChunk.get(chunk) ?? 0;
        perChunk.set(chunk, index + 1);
        buildings.push(
          makeBuilding(
            `b_${chunkCoord(x)}_${chunkCoord(z)}_${index}`,
            chunk,
            style,
            b.district,
            { x, z, w, d },
            centrality,
            rand,
          ),
        );
      }
  }

  // 5. Spawns and the warm-up lap, on arterials (always kept, so always drivable).
  const arterials = xs.map((_, k) => k).filter(isArterial);
  const interior = arterials.filter((k) => k > 0 && k < n - 1);
  const a1 = interior.reduce((best, k) =>
    Math.abs(k - (n - 1) / 2) < Math.abs(best - (n - 1) / 2) ? k : best,
  );
  const a2 = arterials.find((k) => k > a1)!;
  const at = (i: number, j: number): { x: number; z: number } => ({ x: xs[i]!, z: zs[j]! });
  const lap = [at(a1, a1), at(0, a1), at(0, 0), at(a2, 0), at(a2, a1), at(a1, a1)];
  // Player: inner northbound lane of column a1, south of the first checkpoint, facing north (-Z).
  const segStart = zs[a1]! + widthZ[a1]! / 2;
  const segEnd = zs[a1 + 1]! - widthZ[a1 + 1]! / 2;
  const spawnZ = Math.min(zs[a1]! + 45, segEnd - 8);
  const lane = ARTERIAL_WIDTH / 2 - 1.6; // kerbside lane centre
  const spawnPoints: SpawnPoint[] = [
    { kind: 'player', x: xs[a1]! + 2, z: spawnZ, yaw: Math.PI, vehicle: 'sports' },
    {
      kind: 'parked',
      x: xs[a1]! + lane,
      z: Math.min(spawnZ + 16, segEnd - 4),
      yaw: Math.PI,
      vehicle: 'police',
    },
    { kind: 'parked', x: xs[a1]! - lane, z: Math.max(spawnZ - 18, segStart + 4), yaw: 0, vehicle: 'van' },
  ];
  // Two more parked cars at the kerb of streets (not arterials), so the city does not look empty.
  const streets = surfaces.filter((s) => s.kind === 'road' && !s.arterial && Math.max(s.w, s.d) > 30);
  for (const [k, vehicle] of (['compact', 'sedan'] as const).entries()) {
    const s = streets[Math.floor(((k + 1) * streets.length) / 3)];
    if (!s) break;
    const off = STREET_WIDTH / 2 - 1.4;
    spawnPoints.push(
      s.alongX
        ? { kind: 'parked', x: s.x, z: s.z + off, yaw: Math.PI / 2, vehicle }
        : { kind: 'parked', x: s.x + off, z: s.z, yaw: Math.PI, vehicle },
    );
  }

  const zones: Zone[] = blocks.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, district: b.district }));
  const chunks = [...new Set([...surfaces.map((s) => s.chunk), ...buildings.map((b) => b.chunk)])].sort();
  return {
    options: o,
    seed: o.seed,
    bounds,
    core,
    lines: { xs, zs, widthX, widthZ },
    roads,
    blocks,
    surfaces,
    sea,
    buildings,
    spawnPoints,
    lap,
    zones,
    chunks,
  };
}

function pickStyle(
  district: District,
  lotSize: number,
  centrality: number,
  rand: () => number,
): BuildingStyle {
  const r = rand();
  switch (district) {
    case 'downtown':
      return lotSize >= 20 && r < 0.35 + 0.4 * centrality ? 'downtown_tower' : 'downtown_office';
    case 'beach':
      return lotSize >= 16 && r < 0.6 ? 'beach_hotel' : 'beach_shop';
    case 'ind':
      return 'ind_warehouse';
    default:
      return r < 0.35 ? 'res_lowrise' : 'res_house';
  }
}

const FLOOR_H: Record<BuildingStyle, { ground: number; floor: number }> = {
  downtown_tower: { ground: 4.5, floor: 3.6 },
  downtown_office: { ground: 4.5, floor: 3.6 },
  beach_hotel: { ground: 4.5, floor: 3.2 },
  beach_shop: { ground: 4.5, floor: 3.2 },
  res_house: { ground: 3.0, floor: 3.0 },
  res_lowrise: { ground: 3.0, floor: 3.0 },
  ind_warehouse: { ground: 7, floor: 1 },
};

/** Massing per style (T0018 §4 step 3): floors, stacked tiers, roof. */
function makeBuilding(
  id: string,
  chunk: string,
  style: BuildingStyle,
  district: District,
  fp: Rect,
  centrality: number,
  rand: () => number,
): Building {
  const baseY = KERB_HEIGHT;
  const fh = FLOOR_H[style];
  let floors: number;
  let roof: RoofKind = 'flat';
  let windows: Building['windows'] = 'bays';
  switch (style) {
    case 'downtown_tower':
      floors = 12 + Math.floor(rand() * (8 + 14 * centrality));
      windows = 'ribbon';
      break;
    case 'downtown_office':
      floors = 5 + Math.floor(rand() * (4 + 5 * centrality));
      windows = rand() < 0.5 ? 'ribbon' : 'bays';
      break;
    case 'beach_hotel':
      floors = 6 + Math.floor(rand() * 9);
      break;
    case 'beach_shop':
      floors = 1 + Math.floor(rand() * 2);
      break;
    case 'res_house':
      floors = 1 + Math.floor(rand() * 2);
      roof = 'hip';
      break;
    case 'res_lowrise':
      floors = 3 + Math.floor(rand() * 4);
      break;
    case 'ind_warehouse':
      floors = 1;
      roof = 'gable';
      windows = 'high';
      break;
  }
  const groundH = style === 'ind_warehouse' ? 7 + rand() * 4 : fh.ground;
  const floorTop = (k: number): number => baseY + (k === 0 ? 0 : groundH + (k - 1) * fh.floor);

  // Tiers: podium + inset tower + setbacks for towers, an optional setback for offices.
  const tiers: Tier[] = [];
  let cur: Rect = { ...fp };
  let from = 0;
  const push = (to: number): void => {
    tiers.push({ ...cur, y0: floorTop(from), y1: floorTop(to) });
    from = to;
  };
  const inset = (r: Rect, m: number): Rect | null =>
    Math.min(r.w, r.d) - 2 * m >= 9 ? { x: r.x, z: r.z, w: r.w - 2 * m, d: r.d - 2 * m } : null;
  if (style === 'downtown_tower') {
    const podium = 2 + Math.floor(rand() * 2);
    const tower = inset(cur, 2 + rand() * 2);
    if (tower) {
      push(podium);
      cur = tower;
    }
    let setbacks = Math.floor(rand() * 3);
    while (setbacks-- > 0) {
      const next = from + 8 + Math.floor(rand() * 8);
      const smaller = inset(cur, 2 + rand());
      if (next >= floors - 2 || !smaller) break;
      push(next);
      cur = smaller;
    }
  } else if (style === 'downtown_office' && floors >= 7 && rand() < 0.4) {
    const smaller = inset(cur, 2 + rand());
    if (smaller) {
      push(Math.round(floors * (0.6 + rand() * 0.15)));
      cur = smaller;
    }
  }
  push(floors);

  const top = tiers[tiers.length - 1]!;
  const short = Math.min(top.w, top.d);
  const roofHeight = roof === 'hip' ? short * 0.3 : roof === 'gable' ? short * 0.12 : 0;
  const palette = PALETTES[style];
  return {
    id,
    chunk,
    style,
    district,
    x: fp.x,
    z: fp.z,
    w: fp.w,
    d: fp.d,
    baseY,
    height: top.y1,
    floors,
    groundHeight: groundH,
    floorHeight: fh.floor,
    tiers,
    roof,
    roofHeight,
    tint: palette[Math.floor(rand() * palette.length)]!,
    roofTint:
      roof === 'hip'
        ? [0xb5553a, 0x9c4a35, 0xc06a45][Math.floor(rand() * 3)]!
        : roof === 'gable'
          ? 0x9aa3a8
          : 0x8d8c88,
    windows,
    seed: Math.floor(rand() * 0x7fffffff),
  };
}
