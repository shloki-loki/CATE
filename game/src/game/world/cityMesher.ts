import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { CityData } from './generateCity';
import { BUILDING_STYLES, type Building, type BuildingStyle, type Rect, type Surface } from './cityTypes';

/**
 * Turns CityData into Three.js meshes (T0018 §4). This is the only file in game/world that
 * creates scene objects (T0016 §4.2 rule 3).
 *
 * - Runtime (`buildCityMesh`): one merged mesh per material per 256 m chunk, so the whole
 *   city costs a few dozen draw calls. Facade meshes keep a `buildingId -> index range`
 *   table in `userData.buildings` (T0018 §4 step 8).
 * - Export (`buildCityExportScene`): the same geometry, but every building is its own mesh
 *   node named `b_<chunkX>_<chunkZ>_<index>`, for glTF export (see exportCity.ts).
 *
 * Nothing overlaps: ground pieces tile the land, markings are cut into the road surface
 * instead of laid on top of it, window rows are cut into the walls, upper tiers stand on a
 * roof ring that stops at their footprint, and building bottoms are not drawn.
 */

/** Water surface height; the land edge drops to it. */
export const SEA_LEVEL = -0.6;

type MatName =
  | 'mat_asphalt'
  | 'mat_sidewalk'
  | 'mat_kerb'
  | 'mat_grass'
  | 'mat_sand'
  | 'mat_water'
  | 'mat_roof'
  | `mat_facade_${BuildingStyle}`;

/** Shared city materials, named from the fixed T0018 §8.3 list. */
function createMaterials(): Record<MatName, MeshStandardMaterial> {
  const m = (name: MatName, color: number, roughness: number, vertexColors = false, metalness = 0) =>
    new MeshStandardMaterial({ name, color, roughness, metalness, vertexColors });
  const out = {
    mat_asphalt: m('mat_asphalt', 0xffffff, 0.9, true),
    mat_sidewalk: m('mat_sidewalk', 0xbdb8ae, 0.92),
    mat_kerb: m('mat_kerb', 0xd8d4cb, 0.85),
    mat_grass: m('mat_grass', 0x5f9445, 0.95),
    mat_sand: m('mat_sand', 0xe6d3a3, 0.97),
    mat_water: m('mat_water', 0x1f8fb3, 0.12, false, 0.1),
    mat_roof: m('mat_roof', 0xffffff, 0.9, true),
  } as Record<MatName, MeshStandardMaterial>;
  for (const s of BUILDING_STYLES) out[`mat_facade_${s}`] = m(`mat_facade_${s}`, 0xffffff, 0.72, true);
  return out;
}

let shared: Record<MatName, MeshStandardMaterial> | null = null;
export function cityMaterials(): Record<MatName, MeshStandardMaterial> {
  return (shared ??= createMaterials());
}

// ---------------------------------------------------------------------------------------
// Geometry builder: flat-shaded quads and triangles with optional vertex colours.

type V3 = readonly [number, number, number];
const tmpColor = new Color();

class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  constructor(
    readonly colors: boolean,
    private readonly ox = 0,
    private readonly oz = 0,
  ) {}

  get indexCount(): number {
    return this.idx.length;
  }

  /** Convex polygon (3 or 4 points), turned so its normal agrees with `hint`. */
  poly(pts: readonly V3[], hint: V3, color = 0xffffff): void {
    const [a, b, c] = pts as [V3, V3, V3];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const s = (flip ? -1 : 1) / len;
    nx *= s;
    ny *= s;
    nz *= s;
    const base = this.pos.length / 3;
    if (this.colors) tmpColor.setHex(color);
    for (const p of pts) {
      this.pos.push(p[0] - this.ox, p[1], p[2] - this.oz);
      this.nrm.push(nx, ny, nz);
      if (this.colors) this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    for (let k = 1; k + 1 < pts.length; k++) {
      if (flip) this.idx.push(base, base + k + 1, base + k);
      else this.idx.push(base, base + k, base + k + 1);
    }
  }

  /** Horizontal rectangle facing up (or down) at height y. */
  hRect(x0: number, z0: number, x1: number, z1: number, y: number, color?: number, up = true): void {
    if (x1 - x0 < 1e-6 || z1 - z0 < 1e-6) return;
    this.poly(
      [
        [x0, y, z0],
        [x0, y, z1],
        [x1, y, z1],
        [x1, y, z0],
      ],
      [0, up ? 1 : -1, 0],
      color,
    );
  }

  /** Vertical rectangle from ground point a to b, between heights y0 and y1, facing `normal`. */
  vRect(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    y0: number,
    y1: number,
    normal: V3,
    color?: number,
  ): void {
    if (y1 - y0 < 1e-6 || Math.hypot(bx - ax, bz - az) < 1e-6) return;
    this.poly(
      [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      normal,
      color,
    );
  }

  build(name: string): BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new BufferGeometry();
    g.name = name;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    if (this.colors) g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    const n = this.pos.length / 3;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------------------
// Ground: roads with cut-in markings, junctions, raised blocks with kerbs, parks, land.

const ASPHALT = 0x2f3135;
const ALLEY = 0x3a3b3e;
const WHITE = 0xe9e9e4;
const YELLOW = 0xe8b923;

interface Stripe {
  from: number;
  to: number;
  kind: 'asphalt' | 'dash' | 'yellow';
}

/** Lateral layout of a road across its width, measured from the centre line. */
function roadStripes(width: number, arterial: boolean): Stripe[] {
  const h = width / 2;
  const cuts: Stripe[] = arterial
    ? [
        { from: -3.575, to: -3.425, kind: 'dash' },
        { from: -0.22, to: -0.1, kind: 'yellow' },
        { from: 0.1, to: 0.22, kind: 'yellow' },
        { from: 3.425, to: 3.575, kind: 'dash' },
      ]
    : [{ from: -0.075, to: 0.075, kind: 'dash' }];
  const out: Stripe[] = [];
  let at = -h;
  for (const c of cuts) {
    out.push({ from: at, to: c.from, kind: 'asphalt' }, c);
    at = c.to;
  }
  out.push({ from: at, to: h, kind: 'asphalt' });
  return out;
}

function addRoad(g: GeoBuilder, s: Surface): void {
  const alongX = s.alongX ?? s.w >= s.d;
  const len = alongX ? s.w : s.d;
  const wid = alongX ? s.d : s.w;
  const start = alongX ? s.x - len / 2 : s.z - len / 2;
  // (along, across) -> world rectangle.
  const put = (a0: number, a1: number, c0: number, c1: number, color: number): void => {
    if (alongX) g.hRect(start + a0, s.z + c0, start + a1, s.z + c1, 0, color);
    else g.hRect(s.x + c0, start + a0, s.x + c1, start + a1, 0, color);
  };
  for (const st of roadStripes(wid, s.arterial ?? false)) {
    if (st.kind === 'asphalt') put(0, len, st.from, st.to, ASPHALT);
    else if (st.kind === 'yellow') {
      put(0, 1, st.from, st.to, ASPHALT);
      put(1, len - 1, st.from, st.to, YELLOW);
      put(len - 1, len, st.from, st.to, ASPHALT);
    } else {
      // 3 m dashes with 6 m gaps, at least 1.5 m from each junction.
      let a = 0;
      let t = 1.5;
      while (t + 3 <= len - 1.5 + 1e-9) {
        put(a, t, st.from, st.to, ASPHALT);
        put(t, t + 3, st.from, st.to, WHITE);
        a = t + 3;
        t = a + 6;
      }
      put(a, len, st.from, st.to, ASPHALT);
    }
  }
}

function edges(r: Rect): { x0: number; x1: number; z0: number; z1: number } {
  return { x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 };
}

function addKerbs(g: GeoBuilder, s: Surface): void {
  const k = s.kerbs;
  if (!k) return;
  const { x0, x1, z0, z1 } = edges(s);
  if (k.n) g.vRect(x0, z0, x1, z0, 0, s.top, [0, 0, -1]);
  if (k.s) g.vRect(x0, z1, x1, z1, 0, s.top, [0, 0, 1]);
  if (k.w) g.vRect(x0, z0, x0, z1, 0, s.top, [-1, 0, 0]);
  if (k.e) g.vRect(x1, z0, x1, z1, 0, s.top, [1, 0, 0]);
}

/** Park block: a sidewalk ring and a grass centre, as five non-overlapping rectangles. */
function addPark(sidewalk: GeoBuilder, grass: GeoBuilder, s: Surface, ring: number): void {
  const { x0, x1, z0, z1 } = edges(s);
  const y = s.top;
  sidewalk.hRect(x0, z0, x1, z0 + ring, y);
  sidewalk.hRect(x0, z1 - ring, x1, z1, y);
  sidewalk.hRect(x0, z0 + ring, x0 + ring, z1 - ring, y);
  sidewalk.hRect(x1 - ring, z0 + ring, x1, z1 - ring, y);
  grass.hRect(x0 + ring, z0 + ring, x1 - ring, z1 - ring, y);
}

// ---------------------------------------------------------------------------------------
// Buildings: tiers with window rows cut into the walls, roof rings, hip and gable roofs.

const GLASS = [0x22384b, 0x2b4858, 0x1f2f3f, 0x33515d, 0x283f55];
const SHOPFRONT = [0x4d6f7d, 0x5a7f8a, 0x3f6170];

/** Small deterministic hash -> [0, 1). */
function hash01(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function floorBase(b: Building, k: number): number {
  return b.baseY + (k === 0 ? 0 : b.groundHeight + (k - 1) * b.floorHeight);
}

interface Row {
  y0: number;
  y1: number;
  glass: number;
  /** Fraction of each bay that is glass (ribbon: 1). */
  fill: number;
  bay: number;
}

/** Window rows of a tier, in order from the bottom. */
function windowRows(b: Building, y0: number, y1: number): Row[] {
  const rows: Row[] = [];
  const glass = GLASS[Math.floor(hash01(b.seed, 1) * GLASS.length)]!;
  if (b.windows === 'high') {
    rows.push({ y0: y1 - 2.4, y1: y1 - 1.2, glass, fill: 0.6, bay: 6 });
    return rows;
  }
  const house = b.style === 'res_house';
  for (let k = 0; k < b.floors; k++) {
    const fb = floorBase(b, k);
    const fh = k === 0 ? b.groundHeight : b.floorHeight;
    if (fb < y0 - 1e-6 || fb + fh > y1 + 1e-6) continue;
    if (k === 0 && b.groundHeight >= 4.5) {
      const shop = SHOPFRONT[Math.floor(hash01(b.seed, 2) * SHOPFRONT.length)]!;
      rows.push({ y0: fb + 0.45, y1: fb + 3.4, glass: shop, fill: 0.78, bay: 4 });
    } else if (house) {
      rows.push({ y0: fb + 0.9, y1: fb + 2.25, glass, fill: 0.38, bay: 3.4 });
    } else {
      rows.push({
        y0: fb + 0.9,
        y1: fb + fh - 0.6,
        glass,
        fill: b.windows === 'ribbon' ? 1 : 0.55,
        bay: b.style === 'beach_hotel' ? 3.6 : 3.2,
      });
    }
  }
  return rows;
}

/** One wall from corner a to corner b (outward normal n), with window rows cut in. */
function addWall(
  g: GeoBuilder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  n: V3,
  rows: Row[],
  tint: number,
): void {
  const len = Math.hypot(bx - ax, bz - az);
  const at = (t: number): [number, number] => [ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len];
  let y = y0;
  for (const r of rows) {
    if (r.y0 < y - 1e-6 || r.y1 > y1 + 1e-6) continue;
    g.vRect(ax, az, bx, bz, y, r.y0, n, tint);
    // Cut the row into piers (wall colour) and glass, left to right.
    const pieces: [number, number, number][] = [];
    if (r.fill >= 1) {
      const pier = Math.min(0.6, len / 4);
      pieces.push([0, pier, tint], [pier, len - pier, r.glass], [len - pier, len, tint]);
    } else {
      const bays = Math.max(1, Math.round(len / r.bay));
      const bw = len / bays;
      const gw = bw * r.fill;
      let t = 0;
      for (let k = 0; k < bays; k++) {
        const g0 = k * bw + (bw - gw) / 2;
        pieces.push([t, g0, tint], [g0, g0 + gw, r.glass]);
        t = g0 + gw;
      }
      pieces.push([t, len, tint]);
    }
    for (const [t0, t1, c] of pieces) {
      if (t1 - t0 < 1e-6) continue;
      const [px, pz] = at(t0);
      const [qx, qz] = at(t1);
      g.vRect(px, pz, qx, qz, r.y0, r.y1, n, c);
    }
    y = r.y1;
  }
  g.vRect(ax, az, bx, bz, y, y1, n, tint);
}

function addBuilding(b: Building, facade: GeoBuilder, roof: GeoBuilder): void {
  const tint = b.tint;
  b.tiers.forEach((t, ti) => {
    const { x0, x1, z0, z1 } = edges(t);
    const rows = windowRows(b, t.y0, t.y1);
    addWall(facade, x0, z0, x1, z0, t.y0, t.y1, [0, 0, -1], rows, tint);
    addWall(facade, x1, z1, x0, z1, t.y0, t.y1, [0, 0, 1], rows, tint);
    addWall(facade, x0, z1, x0, z0, t.y0, t.y1, [-1, 0, 0], rows, tint);
    addWall(facade, x1, z0, x1, z1, t.y0, t.y1, [1, 0, 0], rows, tint);
    const next = b.tiers[ti + 1];
    if (next) {
      // Roof ring around the next tier's footprint.
      const s = edges(next);
      roof.hRect(x0, z0, x1, s.z0, t.y1, b.roofTint);
      roof.hRect(x0, s.z1, x1, z1, t.y1, b.roofTint);
      roof.hRect(x0, s.z0, s.x0, s.z1, t.y1, b.roofTint);
      roof.hRect(s.x1, s.z0, x1, s.z1, t.y1, b.roofTint);
      return;
    }
    const y = t.y1;
    const h = b.roofHeight;
    if (b.roof === 'flat' || h <= 0) {
      roof.hRect(x0, z0, x1, z1, y, b.roofTint);
      return;
    }
    const alongX = t.w >= t.d;
    const cx = t.x;
    const cz = t.z;
    if (b.roof === 'hip') {
      // Ridge along the long side, hips at both ends.
      const r = (alongX ? t.w - t.d : t.d - t.w) / 2;
      const ra: V3 = alongX ? [cx - r, y + h, cz] : [cx, y + h, cz - r];
      const rb: V3 = alongX ? [cx + r, y + h, cz] : [cx, y + h, cz + r];
      const c00: V3 = [x0, y, z0];
      const c10: V3 = [x1, y, z0];
      const c11: V3 = [x1, y, z1];
      const c01: V3 = [x0, y, z1];
      if (alongX) {
        roof.poly([c00, c10, rb, ra], [0, 1, -1], b.roofTint);
        roof.poly([c01, ra, rb, c11], [0, 1, 1], b.roofTint);
        roof.poly([c00, ra, c01], [-1, 1, 0], b.roofTint);
        roof.poly([c10, c11, rb], [1, 1, 0], b.roofTint);
      } else {
        roof.poly([c00, ra, rb, c01], [-1, 1, 0], b.roofTint);
        roof.poly([c10, c11, rb, ra], [1, 1, 0], b.roofTint);
        roof.poly([c00, c10, ra], [0, 1, -1], b.roofTint);
        roof.poly([c01, rb, c11], [0, 1, 1], b.roofTint);
      }
      return;
    }
    // Gable: ridge along the full long side, triangular wall ends in the facade colour.
    if (alongX) {
      const ra: V3 = [x0, y + h, cz];
      const rb: V3 = [x1, y + h, cz];
      roof.poly([[x0, y, z0], [x1, y, z0], rb, ra], [0, 1, -1], b.roofTint);
      roof.poly([[x0, y, z1], ra, rb, [x1, y, z1]], [0, 1, 1], b.roofTint);
      facade.poly([[x0, y, z0], ra, [x0, y, z1]], [-1, 0, 0], tint);
      facade.poly([[x1, y, z0], [x1, y, z1], rb], [1, 0, 0], tint);
    } else {
      const ra: V3 = [cx, y + h, z0];
      const rb: V3 = [cx, y + h, z1];
      roof.poly([[x0, y, z0], ra, rb, [x0, y, z1]], [-1, 1, 0], b.roofTint);
      roof.poly([[x1, y, z0], [x1, y, z1], rb, ra], [1, 1, 0], b.roofTint);
      facade.poly([[x0, y, z0], [x1, y, z0], ra], [0, 0, -1], tint);
      facade.poly([[x0, y, z1], rb, [x1, y, z1]], [0, 0, 1], tint);
    }
  });
}

// ---------------------------------------------------------------------------------------
// Assembly.

const PART_OF: Record<string, string> = {
  mat_asphalt: 'road',
  mat_sidewalk: 'sidewalk',
  mat_kerb: 'kerb',
  mat_grass: 'grass',
  mat_sand: 'sand',
  mat_water: 'sea',
  mat_roof: 'roof',
};
/** Mesh part name for a material: `mat_facade_beach_hotel` -> `facade_beach_hotel` (T0018 §8.2). */
export function partName(mat: string): string {
  return PART_OF[mat] ?? mat.replace(/^mat_/, '');
}

const PARK_RING = 3;

function addGround(city: CityData, get: (chunk: string, mat: MatName) => GeoBuilder): void {
  for (const s of city.surfaces) {
    const { x0, x1, z0, z1 } = edges(s);
    switch (s.kind) {
      case 'road':
        addRoad(get(s.chunk, 'mat_asphalt'), s);
        break;
      case 'junction':
        get(s.chunk, 'mat_asphalt').hRect(x0, z0, x1, z1, 0, ASPHALT);
        break;
      case 'alley':
        get(s.chunk, 'mat_asphalt').hRect(x0, z0, x1, z1, 0, ALLEY);
        break;
      case 'block':
      case 'walk':
        get(s.chunk, 'mat_sidewalk').hRect(x0, z0, x1, z1, s.top);
        break;
      case 'park':
        addPark(get(s.chunk, 'mat_sidewalk'), get(s.chunk, 'mat_grass'), s, PARK_RING);
        break;
      case 'grass':
        get(s.chunk, 'mat_grass').hRect(x0, z0, x1, z1, 0);
        break;
      case 'sand':
        get(s.chunk, 'mat_sand').hRect(x0, z0, x1, z1, 0);
        break;
    }
    addKerbs(get(s.chunk, 'mat_kerb'), s);
  }
}

/** Land edge down to the water, and the sea around the land (not chunked: always visible). */
function addShoreAndSea(city: CityData, shore: GeoBuilder, sea: GeoBuilder): void {
  const { x0, x1, z0, z1 } = edges(city.bounds);
  shore.vRect(x0, z0, x1, z0, SEA_LEVEL, 0, [0, 0, -1]);
  shore.vRect(x0, z1, x1, z1, SEA_LEVEL, 0, [0, 0, 1]);
  shore.vRect(x0, z0, x0, z1, SEA_LEVEL, 0, [-1, 0, 0]);
  shore.vRect(x1, z0, x1, z1, SEA_LEVEL, 0, [1, 0, 0]);
  for (const r of city.sea) {
    const e = edges(r);
    sea.hRect(e.x0, e.z0, e.x1, e.z1, SEA_LEVEL);
  }
}

function makeMesh(name: string, g: BufferGeometry | null, mat: Material | Material[]): Mesh | null {
  if (!g) return null;
  const mesh = new Mesh(g, mat);
  mesh.name = name;
  return mesh;
}

const facadeMat = (s: BuildingStyle): MatName => `mat_facade_${s}`;

export interface CityMeshOptions {
  /**
   * false (runtime): buildings merged per chunk and style.
   * true (export): every building is its own mesh node `b_<cx>_<cz>_<i>`.
   */
  perBuilding?: boolean;
}

/** Builds the scene graph: root `city` -> chunk groups `c_<x>_<z>` -> meshes. */
export function buildCityObject(city: CityData, opts: CityMeshOptions = {}): Group {
  const mats = cityMaterials();
  const root = new Group();
  root.name = 'city';
  root.userData = {
    generator: 'neon-coast/world/generateCity',
    seed: city.seed,
    options: { ...city.options },
    buildings: city.buildings.length,
  };
  const chunkGroups = new Map<string, Group>();
  const chunkGroup = (id: string): Group => {
    let g = chunkGroups.get(id);
    if (!g) {
      g = new Group();
      g.name = id;
      chunkGroups.set(id, g);
    }
    return g;
  };
  for (const c of city.chunks) chunkGroup(c);

  const builders = new Map<string, { chunk: string; mat: MatName; g: GeoBuilder }>();
  const get = (chunk: string, mat: MatName): GeoBuilder => {
    const k = `${chunk}|${mat}`;
    let e = builders.get(k);
    if (!e) {
      e = { chunk, mat, g: new GeoBuilder(mats[mat].vertexColors) };
      builders.set(k, e);
    }
    return e.g;
  };
  addGround(city, get);

  const ranges = new Map<string, { id: string; start: number; count: number }[]>();
  for (const b of city.buildings) {
    if (opts.perBuilding) {
      const facade = new GeoBuilder(true, b.x, b.z);
      const roof = new GeoBuilder(true, b.x, b.z);
      addBuilding(b, facade, roof);
      const fg = facade.build(`${b.id}_facade`);
      const rg = roof.build(`${b.id}_roof`);
      const mesh = makeMesh(b.id, mergeTwo(fg, rg), [mats[facadeMat(b.style)], mats.mat_roof]);
      if (!mesh) continue;
      mesh.position.set(b.x, 0, b.z);
      mesh.userData = {
        style: b.style,
        district: b.district,
        floors: b.floors,
        height: Math.round(b.height * 100) / 100,
      };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      chunkGroup(b.chunk).add(mesh);
      continue;
    }
    const facade = get(b.chunk, facadeMat(b.style));
    const start = facade.indexCount;
    addBuilding(b, facade, get(b.chunk, 'mat_roof'));
    const key = `${b.chunk}|${facadeMat(b.style)}`;
    const list = ranges.get(key) ?? [];
    list.push({ id: b.id, start, count: facade.indexCount - start });
    ranges.set(key, list);
  }

  for (const [k, { chunk, mat, g }] of builders) {
    const mesh = makeMesh(partName(mat), g.build(`${chunk}_${partName(mat)}`), mats[mat]);
    if (!mesh) continue;
    const building = mat.startsWith('mat_facade_') || mat === 'mat_roof';
    mesh.castShadow = building;
    mesh.receiveShadow = true;
    if (ranges.has(k)) mesh.userData = { buildings: ranges.get(k) };
    chunkGroup(chunk).add(mesh);
  }
  for (const id of [...chunkGroups.keys()].sort()) {
    const g = chunkGroups.get(id)!;
    if (g.children.length) root.add(g);
  }

  const shore = new GeoBuilder(false);
  const sea = new GeoBuilder(false);
  addShoreAndSea(city, shore, sea);
  const shoreMesh = makeMesh('shore', shore.build('shore'), mats.mat_sand);
  const seaMesh = makeMesh('sea', sea.build('sea'), mats.mat_water);
  if (shoreMesh) root.add(shoreMesh);
  if (seaMesh) {
    seaMesh.receiveShadow = true;
    root.add(seaMesh);
  }
  root.updateMatrixWorld(true);
  return root;
}

/** Two geometries -> one with two groups (material 0 and 1), for multi-material export. */
function mergeTwo(a: BufferGeometry | null, b: BufferGeometry | null): BufferGeometry | null {
  if (!a) return b;
  if (!b) {
    a.addGroup(0, a.index!.count, 0);
    return a;
  }
  const na = a.attributes.position!.count;
  const g = new BufferGeometry();
  g.name = a.name.replace(/_facade$/, '');
  for (const attr of ['position', 'normal', 'color']) {
    const x = a.getAttribute(attr) as BufferAttribute;
    const y = b.getAttribute(attr) as BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(attr, new BufferAttribute(arr, 3));
  }
  const ia = a.index!.array;
  const ib = b.index!.array;
  const total = na + b.attributes.position!.count;
  const idx = total > 65535 ? new Uint32Array(ia.length + ib.length) : new Uint16Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let k = 0; k < ib.length; k++) idx[ia.length + k] = ib[k]! + na;
  g.setIndex(new BufferAttribute(idx, 1));
  g.addGroup(0, ia.length, 0);
  g.addGroup(ia.length, ib.length, 1);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  a.dispose();
  b.dispose();
  return g;
}

/** Runtime city: merged meshes per chunk and material. */
export function buildCityMesh(city: CityData): Group {
  return buildCityObject(city, { perBuilding: false });
}

/** Export city: one mesh node per building, named by the T0018 convention. */
export function buildCityExportScene(city: CityData): Group {
  return buildCityObject(city, { perBuilding: true });
}

/** Frees the GPU geometry of a city object (the shared materials stay). */
export function disposeCityObject(root: Object3D): void {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose();
  });
}
