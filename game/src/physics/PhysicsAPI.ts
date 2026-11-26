import type { Quaternion, Vector3 } from 'three';

/**
 * Physics contract (T0016 §4.3). Only src/physics/rapier/ talks to Rapier;
 * everyone else uses this interface.
 *
 * T0019 implements bodies, transforms, impulses and raycasts. Vehicles
 * (T0020: createVehicle/setVehicleInput/getVehicleState), characters
 * (T0021: createCharacter/moveCharacter), shape casts and contact events are
 * added to this interface by those tasks.
 */
export type BodyHandle = number & { readonly __brand: 'Body' };

/** Collision groups (bit index). Rapier allows 16. */
export const CollisionGroup = {
  WORLD_STATIC: 1 << 0,
  VEHICLE: 1 << 1,
  CHARACTER: 1 << 2,
  PROP: 1 << 3,
  PROJECTILE: 1 << 4,
  SENSOR: 1 << 5,
  CAMERA_IGNORE: 1 << 6,
} as const;
export const ALL_GROUPS = 0xffff;

export type ColliderShape =
  | {
      kind: 'box';
      halfExtents: { x: number; y: number; z: number };
      offset?: { x: number; y: number; z: number };
    }
  | { kind: 'sphere'; radius: number; offset?: { x: number; y: number; z: number } }
  | { kind: 'capsule'; halfHeight: number; radius: number; offset?: { x: number; y: number; z: number } };

export interface BodyDesc {
  type: 'static' | 'dynamic' | 'kinematic';
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  shapes: ColliderShape[];
  /** Which group this body is in (one CollisionGroup bit). Default WORLD_STATIC for static, PROP otherwise. */
  group?: number;
  /** Which groups it collides with. Default ALL_GROUPS. */
  collidesWith?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  /** Enable continuous collision detection (fast cars, projectiles). */
  ccd?: boolean;
}

export interface Transform {
  position: Vector3;
  quaternion: Quaternion;
}

export interface RayHit {
  body: BodyHandle | null;
  distance: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

export interface PhysicsAPI {
  /** Loads the physics WASM. Must resolve before anything else is called. */
  init(): Promise<void>;
  step(dt: number): void;
  createBody(d: BodyDesc): BodyHandle;
  removeBody(h: BodyHandle): void;
  /** Writes into `out` and returns it (no allocation). */
  getTransform(h: BodyHandle, out: Transform): Transform;
  setTransform(h: BodyHandle, t: Transform): void;
  applyImpulse(h: BodyHandle, impulse: { x: number; y: number; z: number }): void;
  raycast(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    mask?: number,
  ): RayHit | null;
  readonly bodyCount: number;
  dispose(): void;
}
