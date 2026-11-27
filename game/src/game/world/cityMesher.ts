import type { BufferGeometry } from 'three';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { City } from './generateCity';

/**
 * Turns a City into a few merged meshes (placeholder look; T0018 supplies real models).
 * Everything is merged by material, so the whole city costs about a dozen draw calls
 * regardless of how many roads or buildings it has.
 */
const mats = {
  grass: new MeshStandardMaterial({ color: 0x6f9a4e, roughness: 0.9 }),
  sand: new MeshStandardMaterial({ color: 0xe8d3a2, roughness: 0.95 }),
  water: new MeshStandardMaterial({ color: 0x1f8fb3, roughness: 0.08, metalness: 0.1 }),
  asphalt: new MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.85 }),
  line: new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  sidewalk: new MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 }),
  park: new MeshStandardMaterial({ color: 0x4c8a3f, roughness: 0.95 }),
  glass: new MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.8 }),
};
const facadeMats = [0xf6c1d0, 0x9ee6e0, 0xfbe3a1, 0xffffff, 0xc7b8f5, 0xffb38a].map(
  (c) => new MeshStandardMaterial({ color: c, roughness: 0.7 }),
);

function flat(w: number, d: number, x: number, y: number, z: number): BufferGeometry {
  const g = new PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function merged(parts: BufferGeometry[]): BufferGeometry | null {
  if (parts.length === 0) return null;
  const m = mergeGeometries(parts);
  if (!m) throw new Error('cityMesher: could not merge geometries');
  for (const p of parts) p.dispose();
  return m;
}

function add(group: Group, parts: BufferGeometry[], mat: MeshStandardMaterial, cast: boolean): void {
  const g = merged(parts);
  if (!g) return;
  const mesh = new Mesh(g, mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Size of the ground plane that covers the city plus a margin. */
export function groundSize(city: City): number {
  return Math.ceil((city.extent * 2 + 80) / 10) * 10;
}

export function buildCityMesh(city: City): Object3D {
  const root = new Group();
  root.name = 'city';
  const size = groundSize(city);
  const half = size / 2;

  // Ground, with a beach strip and the sea on the east side.
  add(root, [flat(size, size, 0, 0, 0)], mats.grass, false);
  add(root, [flat(40, size, half - 20, 0.01, 0)], mats.sand, false);
  const sea = new Mesh(
    new PlaneGeometry(800, size * 3).rotateX(-Math.PI / 2).translate(half + 400, -0.2, 0),
    mats.water,
  );
  sea.receiveShadow = true;
  root.add(sea);

  // Sidewalk slabs (blocks) and parks.
  add(
    root,
    city.blocks.filter((b) => !b.park).map((b) => flat(b.w, b.d, b.x, 0.03, b.z)),
    mats.sidewalk,
    false,
  );
  add(
    root,
    city.blocks.filter((b) => b.park).map((b) => flat(b.w, b.d, b.x, 0.03, b.z)),
    mats.park,
    false,
  );

  // Roads: one quad per edge plus a square at every intersection.
  const roads: BufferGeometry[] = [];
  const dashes: BufferGeometry[] = [];
  for (const e of city.roads.edges) {
    const a = city.roads.node(e.a);
    const b = city.roads.node(e.b);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    roads.push(e.alongX ? flat(e.length, e.width, cx, 0.02, cz) : flat(e.width, e.length, cx, 0.02, cz));
    // Dashed centre line, skipping the intersections at both ends.
    const margin = city.roads.junctionWidth(e.a) / 2 + 2;
    const margin2 = city.roads.junctionWidth(e.b) / 2 + 2;
    for (let t = margin; t < e.length - margin2; t += 8) {
      const along = -e.length / 2 + t + 1.5;
      dashes.push(e.alongX ? flat(3, 0.25, cx + along, 0.035, cz) : flat(0.25, 3, cx, 0.035, cz + along));
    }
  }
  for (const n of city.roads.nodes) {
    const w = city.roads.junctionWidth(n.id);
    if (w > 0) roads.push(flat(w, w, n.x, 0.021, n.z));
  }
  add(root, roads, mats.asphalt, false);
  add(root, dashes, mats.line, false);

  // Buildings: bodies merged per facade colour, window bands merged into one mesh.
  const bodies: BufferGeometry[][] = facadeMats.map(() => []);
  const bands: BufferGeometry[] = [];
  for (const b of city.buildings) {
    bodies[b.color % facadeMats.length]!.push(new BoxGeometry(b.w, b.h, b.d).translate(b.x, b.h / 2, b.z));
    const floors = Math.max(1, Math.floor(b.h / 3.5) - 1);
    for (let f = 0; f < floors; f++) {
      const y = 3 + f * 3.5;
      bands.push(new BoxGeometry(b.w * 0.86, 1.1, b.d + 0.1).translate(b.x, y, b.z));
      bands.push(new BoxGeometry(b.w + 0.1, 1.1, b.d * 0.86).translate(b.x, y, b.z));
    }
  }
  bodies.forEach((parts, i) => add(root, parts, facadeMats[i]!, true));
  add(root, bands, mats.glass, false);
  return root;
}
