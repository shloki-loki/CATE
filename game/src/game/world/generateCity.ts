import { mulberry32 } from './rng';
import { RoadGraph } from './roadGraph';

/** An axis-aligned rectangle on the ground plane (centre + full size, metres). */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Building extends Rect {
  /** Height in metres. */
  h: number;
  /** Index into the facade palette. */
  color: number;
  /** Distance-from-centre class, for later LOD/material choices. */
  district: 'downtown' | 'midrise' | 'suburb';
}

export interface Block extends Rect {
  park: boolean;
}

export interface CityOptions {
  seed: number;
  /** Intersections per side (>= 3). */
  gridSize: number;
  /** Mean spacing between road lines, metres. */
  spacing: number;
  /** Probability that a non-essential street segment is removed (never breaks connectivity). */
  dropChance: number;
}

export const DEFAULT_CITY: CityOptions = { seed: 1986, gridSize: 6, spacing: 62, dropChance: 0.18 };

export const ARTERIAL_WIDTH = 16;
export const STREET_WIDTH = 11;
/** Gap between neighbouring blocks where a street segment was removed (an alley). */
const ALLEY = 5;

export interface City {
  options: CityOptions;
  roads: RoadGraph;
  blocks: Block[];
  buildings: Building[];
  /** Half the side length of the area covered by blocks and roads. */
  extent: number;
}

/** Union-find used to keep the network connected while removing streets. */
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
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.p[ra] = rb;
    return true;
  }
}

/**
 * Procedural city (pure, deterministic for a seed).
 *
 * 1. Road lines: gridSize x gridSize intersections with irregular spacing; every third
 *    line (and the outer ring) is a wide arterial.
 * 2. Streets: segments are visited in random order; a segment is kept if it joins two
 *    separate parts of the network (this builds a spanning tree, so the network is always
 *    connected), otherwise it is kept with probability 1 - dropChance. Arterials and the
 *    outer ring are always kept.
 * 3. Blocks: each grid cell, inset by half the width of whichever road lies on each side
 *    (or an alley gap where the street was dropped).
 * 4. Buildings: each block is split into lots; a lot gets a building whose height grows
 *    toward the centre. Some blocks become parks.
 */
export function generateCity(partial: Partial<CityOptions> = {}): City {
  const o: CityOptions = { ...DEFAULT_CITY, ...partial };
  if (!Number.isInteger(o.gridSize) || o.gridSize < 3)
    throw new Error('generateCity: gridSize must be an integer >= 3');
  if (o.spacing < 30) throw new Error('generateCity: spacing must be >= 30');
  const rand = mulberry32(o.seed);
  const n = o.gridSize;

  // 1. Irregular, centred road lines.
  const line = (): number[] => {
    const pos = [0];
    for (let i = 1; i < n; i++) pos.push(pos[i - 1]! + o.spacing * (0.8 + rand() * 0.4));
    const mid = (pos[0]! + pos[n - 1]!) / 2;
    return pos.map((p) => Math.round((p - mid) * 2) / 2);
  };
  const xs = line();
  const zs = line();

  const roads = new RoadGraph();
  const id = (i: number, j: number): number => j * n + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) roads.addNode(xs[i]!, zs[j]!);

  const isArterialLine = (k: number): boolean => k === 0 || k === n - 1 || k % 3 === 0;
  interface Seg {
    a: number;
    b: number;
    arterial: boolean;
    mustKeep: boolean;
    key: string;
  }
  const segs: Seg[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (i + 1 < n)
        segs.push({
          a: id(i, j),
          b: id(i + 1, j),
          arterial: isArterialLine(j),
          mustKeep: j === 0 || j === n - 1,
          key: `h${i},${j}`,
        });
      if (j + 1 < n)
        segs.push({
          a: id(i, j),
          b: id(i, j + 1),
          arterial: isArterialLine(i),
          mustKeep: i === 0 || i === n - 1,
          key: `v${i},${j}`,
        });
    }
  }

  // 2. Keep must-keep segments first, then a random spanning forest, then most of the rest.
  const dsu = new Dsu(n * n);
  const kept = new Set<string>();
  const keep = (s: Seg): void => {
    kept.add(s.key);
    dsu.union(s.a, s.b);
  };
  for (const s of segs) if (s.mustKeep || s.arterial) keep(s);
  const rest = segs.filter((s) => !kept.has(s.key));
  for (let i = rest.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [rest[i], rest[k]] = [rest[k]!, rest[i]!];
  }
  for (const s of rest) {
    if (dsu.find(s.a) !== dsu.find(s.b) || rand() >= o.dropChance) keep(s);
  }
  for (const s of segs) {
    if (kept.has(s.key))
      roads.addEdge(s.a, s.b, s.arterial ? 'arterial' : 'street', s.arterial ? ARTERIAL_WIDTH : STREET_WIDTH);
  }
  // Only possible if arterials alone left separate parts and the spanning pass could not join them.
  if (!roads.isConnected()) throw new Error('generateCity: road network is not connected');

  const widthOf = (s: Seg | undefined): number => (s ? (s.arterial ? ARTERIAL_WIDTH : STREET_WIDTH) : 0);
  const byKey = new Map(segs.map((s) => [s.key, s]));
  const inset = (key: string): number => {
    const s = byKey.get(key);
    return s && kept.has(key) ? widthOf(s) / 2 : ALLEY / 2;
  };

  // 3. Blocks.
  const blocks: Block[] = [];
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const x0 = xs[i]! + inset(`v${i},${j}`);
      const x1 = xs[i + 1]! - inset(`v${i + 1},${j}`);
      const z0 = zs[j]! + inset(`h${i},${j}`);
      const z1 = zs[j + 1]! - inset(`h${i},${j + 1}`);
      blocks.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, park: rand() < 0.08 });
    }
  }

  // 4. Buildings.
  const extent = Math.max(Math.abs(xs[0]!), Math.abs(zs[0]!)) + ARTERIAL_WIDTH / 2;
  const buildings: Building[] = [];
  const SETBACK = 2; // sidewalk between building and kerb
  const LOT = 20;
  for (const b of blocks) {
    if (b.park) continue;
    const nx = Math.max(1, Math.round((b.w - 2 * SETBACK) / LOT));
    const nz = Math.max(1, Math.round((b.d - 2 * SETBACK) / LOT));
    const lw = (b.w - 2 * SETBACK) / nx;
    const ld = (b.d - 2 * SETBACK) / nz;
    for (let a = 0; a < nx; a++) {
      for (let c = 0; c < nz; c++) {
        if (rand() < 0.1) continue; // empty lot
        const cx = b.x - b.w / 2 + SETBACK + lw * (a + 0.5);
        const cz = b.z - b.d / 2 + SETBACK + ld * (c + 0.5);
        const w = lw * (0.7 + rand() * 0.25);
        const d = ld * (0.7 + rand() * 0.25);
        const dist = Math.hypot(cx, cz) / extent; // 0 centre .. ~1.4 corner
        const district = dist < 0.35 ? 'downtown' : dist < 0.7 ? 'midrise' : 'suburb';
        const h =
          district === 'downtown'
            ? 28 + rand() * 60
            : district === 'midrise'
              ? 12 + rand() * 20
              : 6 + rand() * 9;
        buildings.push({ x: cx, z: cz, w, d, h, color: Math.floor(rand() * 6), district });
      }
    }
  }

  return { options: o, roads, blocks, buildings, extent };
}

/** Axis-aligned rectangle covered by a road edge, for overlap tests. */
export function edgeRect(city: City, edgeId: number): Rect {
  const e = city.roads.edges[edgeId]!;
  const a = city.roads.node(e.a);
  const b = city.roads.node(e.b);
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    w: e.alongX ? e.length : e.width,
    d: e.alongX ? e.width : e.length,
  };
}

export function rectsOverlap(p: Rect, q: Rect, margin = 0): boolean {
  return Math.abs(p.x - q.x) < (p.w + q.w) / 2 + margin && Math.abs(p.z - q.z) < (p.d + q.d) / 2 + margin;
}
