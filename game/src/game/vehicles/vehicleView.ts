import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import { WHEEL_NAMES, wheelConnection, type VehicleDef } from './defs';

/**
 * Placeholder vehicle model built from boxes and cylinders, until T0018's generated
 * glTF vehicles replace it. Follows the asset convention: origin on the ground between
 * the axles, front faces +Z, wheel nodes named wheel_FL/FR/RL/RR.
 *
 * Each wheel is a pivot (suspension travel + steering) holding a spinner (rolling).
 */
const shared = {
  glass: new MeshStandardMaterial({ color: 0x2c3e52, roughness: 0.12, metalness: 0.3 }),
  tyre: new MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rim: new MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.35, metalness: 0.3 }),
  trim: new MeshStandardMaterial({ color: 0x222326, roughness: 0.6 }),
  head: new MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 }),
  white: new MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4, metalness: 0.1 }),
  red: new MeshStandardMaterial({ color: 0xff2030, emissive: 0xff1020, emissiveIntensity: 1.4 }),
  blue: new MeshStandardMaterial({ color: 0x2050ff, emissive: 0x1040ff, emissiveIntensity: 1.4 }),
};
const paints = new Map<number, MeshStandardMaterial>();

function paint(color: number): MeshStandardMaterial {
  let m = paints.get(color);
  // Low metalness: there is no environment map yet, and metallic paint renders near-black without one.
  if (!m) paints.set(color, (m = new MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.15 })));
  return m;
}

function box(w: number, h: number, d: number, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface VehicleViewParts {
  root: Object3D;
  wheelPivots: Object3D[];
  wheelSpinners: Object3D[];
  mounts: { x: number; y: number; z: number }[];
  /** Per-vehicle tail-light material, so brake lights light up on this car only. */
  brakeLights: MeshStandardMaterial;
}

export function vehicleView(def: VehicleDef): VehicleViewParts {
  const root = new Group();
  root.name = `vehicle.${def.id}`;
  const body = paint(def.color);
  const { length: L, width: W, height: H, groundClearance: gc } = def;

  // Lower body and cabin proportions per style.
  const van = def.style === 'van';
  const lowerH = van ? H * 0.5 : H * 0.42;
  const cabinH = H - lowerH;
  const cabinL = van ? L * 0.78 : def.style === 'sports' ? L * 0.4 : L * 0.5;
  const cabinZ = van ? -L * 0.08 : def.style === 'sports' ? -L * 0.06 : -L * 0.04;

  root.add(box(W, lowerH, L, body, 0, gc + lowerH / 2, 0));
  const cabin = box(W * 0.9, cabinH, cabinL, body, 0, gc + lowerH + cabinH / 2, cabinZ);
  root.add(cabin);
  // Glass band around the cabin.
  root.add(box(W * 0.92, cabinH * 0.55, cabinL * 1.01, shared.glass, 0, gc + lowerH + cabinH * 0.48, cabinZ));
  // Bumpers.
  root.add(box(W * 1.01, 0.18, 0.12, shared.trim, 0, gc + 0.15, L / 2));
  root.add(box(W * 1.01, 0.18, 0.12, shared.trim, 0, gc + 0.15, -L / 2));
  // Headlights (front, +Z) and tail lights (rear).
  const lightY = gc + lowerH * 0.7;
  for (const s of [1, -1]) {
    root.add(box(W * 0.2, 0.12, 0.05, shared.head, s * W * 0.33, lightY, L / 2 + 0.01));
  }
  const brakeLights = new MeshStandardMaterial({
    color: 0x8a0d12,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.25,
  });
  for (const s of [1, -1]) {
    root.add(box(W * 0.22, 0.12, 0.05, brakeLights, s * W * 0.33, lightY, -L / 2 - 0.01));
  }
  if (def.style === 'police') {
    // Two-tone doors and a light bar.
    root.add(box(W * 1.005, lowerH * 0.6, L * 0.42, shared.white, 0, gc + lowerH * 0.55, -L * 0.02));
    root.add(box(W * 0.3, 0.12, 0.3, shared.red, W * 0.18, gc + H + 0.06, cabinZ));
    root.add(box(W * 0.3, 0.12, 0.3, shared.blue, -W * 0.18, gc + H + 0.06, cabinZ));
  }
  if (def.style === 'sports') {
    root.add(box(W * 0.9, 0.06, 0.32, shared.trim, 0, gc + lowerH + 0.22, -L / 2 + 0.2)); // spoiler
  }

  // Wheels.
  const wheelPivots: Object3D[] = [];
  const wheelSpinners: Object3D[] = [];
  const mounts: { x: number; y: number; z: number }[] = [];
  const r = def.wheelRadius;
  for (let i = 0; i < 4; i++) {
    const m = wheelConnection(def, i);
    mounts.push(m);
    const pivot = new Group();
    pivot.name = WHEEL_NAMES[i]!;
    pivot.position.set(m.x, m.y - def.suspension.restLength, m.z);
    const spinner = new Group();
    const tyre = new Mesh(new CylinderGeometry(r, r, def.wheelWidth, 18), shared.tyre);
    tyre.rotation.z = Math.PI / 2; // cylinder axis along X (the axle)
    tyre.castShadow = true;
    const rim = new Mesh(new CylinderGeometry(r * 0.62, r * 0.62, def.wheelWidth + 0.02, 10), shared.rim);
    rim.rotation.z = Math.PI / 2;
    // A spoke bar so the wheel visibly turns.
    const spoke = new Mesh(new BoxGeometry(def.wheelWidth + 0.03, r * 1.1, r * 0.18), shared.trim);
    spinner.add(tyre, rim, spoke);
    pivot.add(spinner);
    root.add(pivot);
    wheelPivots.push(pivot);
    wheelSpinners.push(spinner);
  }
  return { root, wheelPivots, wheelSpinners, mounts, brakeLights };
}
