import { BoxGeometry, GridHelper, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { ArenaLayout } from './arena';

/** Meshes for the vehicle test arena (T0025), built from the same layout as its colliders. */
const mats = {
  ground: new MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9 }),
  wall: new MeshStandardMaterial({ color: 0xf2a33a, roughness: 0.6 }),
  ramp: new MeshStandardMaterial({ color: 0x4aa3df, roughness: 0.7 }),
  kerb: new MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }),
};

export function arenaView(layout: ArenaLayout): Object3D {
  const g = new Group();
  g.name = 'vehicleArena';
  for (const b of layout.boxes) {
    const h = b.halfExtents;
    const m = new Mesh(new BoxGeometry(h.x * 2, h.y * 2, h.z * 2), mats[b.kind]);
    m.position.set(b.position.x, b.position.y, b.position.z);
    m.rotation.x = b.pitch ?? 0;
    m.receiveShadow = true;
    m.castShadow = b.kind !== 'ground';
    g.add(m);
  }
  // 10 m grid so speed and turning are easy to see.
  const grid = new GridHelper(layout.half * 2, layout.half / 5, 0x8fd3ff, 0x5b6068);
  grid.position.y = 0.01;
  g.add(grid);
  return g;
}
