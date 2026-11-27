import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Object3D,
} from 'three';

/** A glowing see-through beacon marking the next checkpoint (radius in metres). */
export function checkpointMarkerView(radius: number): Object3D {
  const g = new Group();
  const glow = new MeshBasicMaterial({
    color: 0xffd23f,
    transparent: true,
    opacity: 0.28,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const column = new Mesh(new CylinderGeometry(radius, radius, 7, 40, 1, true), glow);
  column.position.y = 3.5;
  column.renderOrder = 10;
  const ring = new Mesh(
    new RingGeometry(radius - 0.6, radius, 48),
    new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 10;
  g.add(column, ring);
  return g;
}
