import {
  BoxGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * View factory for the skeleton demo scene: simple PBR placeholder geometry.
 * T0022 replaces this with the procedural city mesher; T0018 supplies real models.
 * Materials are shared so draw calls stay low.
 */
const mats = {
  sand: new MeshStandardMaterial({ color: 0xe8d3a2, roughness: 0.95 }),
  grass: new MeshStandardMaterial({ color: 0x6f9a4e, roughness: 0.9 }),
  asphalt: new MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.85 }),
  line: new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  water: new MeshStandardMaterial({ color: 0x1f8fb3, roughness: 0.08, metalness: 0.1 }),
  trunk: new MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 }),
  leaves: new MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.8, flatShading: true }),
  crate: new MeshStandardMaterial({ color: 0xc58b4c, roughness: 0.75 }),
  glass: new MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.8 }),
};

const facadeColors = [0xf6c1d0, 0x9ee6e0, 0xfbe3a1, 0xffffff, 0xc7b8f5, 0xffb38a];
const facadeMats = facadeColors.map((c) => new MeshStandardMaterial({ color: c, roughness: 0.7 }));

function mergeOrThrow(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('demoView: could not merge geometries');
  for (const p of parts) p.dispose();
  return merged;
}

function shadowed<T extends Mesh>(m: T, cast = true, receive = true): T {
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function groundView(size: number): Object3D {
  const g = new Group();
  const ground = shadowed(new Mesh(new PlaneGeometry(size, size), mats.grass), false, true);
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);
  // Beach strip and sea along the east edge.
  const beach = shadowed(new Mesh(new PlaneGeometry(60, size), mats.sand), false, true);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(size / 2 - 30, 0.01, 0);
  g.add(beach);
  const sea = new Mesh(new PlaneGeometry(800, size * 3), mats.water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(size / 2 + 400, -0.2, 0);
  sea.receiveShadow = true;
  g.add(sea);
  return g;
}

export function roadView(length: number, width: number, alongX: boolean): Object3D {
  const g = new Group();
  const road = shadowed(
    new Mesh(new PlaneGeometry(alongX ? length : width, alongX ? width : length), mats.asphalt),
    false,
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  g.add(road);
  // Dashed centre line, merged into one mesh (one draw call per road).
  const dashes: BufferGeometry[] = [];
  for (let d = -length / 2 + 3; d < length / 2; d += 8) {
    const dash = new PlaneGeometry(alongX ? 3 : 0.25, alongX ? 0.25 : 3);
    dash.rotateX(-Math.PI / 2);
    dash.translate(alongX ? d : 0, 0.03, alongX ? 0 : d);
    dashes.push(dash);
  }
  const line = new Mesh(mergeOrThrow(dashes), mats.line);
  line.receiveShadow = true;
  g.add(line);
  return g;
}

export function buildingView(w: number, h: number, d: number, colorIndex: number): Object3D {
  const g = new Group();
  const mat = facadeMats[colorIndex % facadeMats.length]!;
  const body = shadowed(new Mesh(new BoxGeometry(w, h, d), mat));
  body.position.y = h / 2;
  g.add(body);
  // Dark window bands, one per ~3.5 m floor on all four sides, merged into one mesh.
  const floors = Math.max(1, Math.floor(h / 3.5) - 1);
  const bands: BufferGeometry[] = [];
  for (let f = 0; f < floors; f++) {
    const y = 3 + f * 3.5;
    bands.push(new BoxGeometry(w * 0.86, 1.1, d + 0.1).translate(0, y, 0));
    bands.push(new BoxGeometry(w + 0.1, 1.1, d * 0.86).translate(0, y, 0));
  }
  g.add(new Mesh(mergeOrThrow(bands), mats.glass));
  return g;
}

export function palmView(height: number): Object3D {
  const g = new Group();
  const trunk = shadowed(new Mesh(new CylinderGeometry(0.18, 0.3, height, 7), mats.trunk));
  trunk.position.y = height / 2;
  trunk.rotation.z = 0.06;
  const crown = shadowed(new Mesh(new DodecahedronGeometry(1.6, 0), mats.leaves));
  crown.position.set(height * 0.06, height + 0.4, 0);
  crown.scale.set(1.4, 0.5, 1.4);
  g.add(trunk, crown);
  return g;
}

export function crateView(size: number): Object3D {
  return shadowed(new Mesh(new BoxGeometry(size, size, size), mats.crate));
}
