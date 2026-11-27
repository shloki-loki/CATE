import type { Quaternion, Vector3 } from 'three';

/**
 * Physics contract (T0016 §4.3). Only src/physics/rapier/ talks to Rapier;
 * everyone else uses this interface.
 *
 * T0019 implements bodies, transforms, impulses and raycasts. T0021 adds
 * characters (createCharacter/moveCharacter/placeCharacter), setBodyEnabled and
 * the sphere cast used by the follow camera. Vehicles (T0020:
 * createVehicle/setVehicleInput/getVehicleState) and contact events are added
 * by those tasks.
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

type Vec3Like = { x: number; y: number; z: number };

/** A kinematic capsule moved by Rapier's KinematicCharacterController (T0021). */
export interface CharacterDesc {
  /** Capsule centre. The feet are `halfHeight + radius` below it. */
  position: Vec3Like;
  radius: number;
  /** Half-height of the capsule's cylinder part. Total height = 2 * (halfHeight + radius). */
  halfHeight: number;
  /** Default CollisionGroup.CHARACTER. */
  group?: number;
  /** Groups the character is blocked by. Default everything except SENSOR and CAMERA_IGNORE. */
  collidesWith?: number;
  /** Steepest slope it can walk up, degrees. Default 50. Steeper slopes make it slide. */
  maxSlopeDeg?: number;
  /** Highest step (curb, stair) it climbs without jumping, metres. Default 0.45. */
  stepHeight?: number;
  /** Distance it stays glued to the ground when walking down slopes/steps. Default 0.35. */
  snapDistance?: number;
  /** Mass used to push dynamic bodies (crates, props), kg. Default 80. */
  mass?: number;
}

export interface CharacterMove {
  /** True when the capsule rests on walkable ground after the move. */
  grounded: boolean;
  /** Translation actually applied this tick, after collisions, sliding and stepping. */
  moved: Vec3Like;
  /** Number of colliders touched during the move. */
  collisions: number;
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
  /**
   * Sweep a sphere from `from` along `dir` and return the first hit (camera spring arm,
   * exit-vehicle clearance). `distance` is how far the sphere centre travelled.
   */
  castSphere(
    from: Vec3Like,
    dir: Vec3Like,
    radius: number,
    maxDist: number,
    mask?: number,
    exclude?: BodyHandle,
  ): RayHit | null;
  /** Disabled bodies are skipped by the simulation and by all queries (player inside a car). */
  setBodyEnabled(h: BodyHandle, enabled: boolean): void;

  /** Create a kinematic character capsule. The handle is a normal body handle (RigidBody component, removeBody). */
  createCharacter(d: CharacterDesc): BodyHandle;
  /**
   * Move a character by `desired` metres this tick (gravity is the caller's job) and face it
   * along `yaw` (radians about +Y; 0 faces -Z). Collides, slides along walls, climbs steps and
   * slopes, snaps to the ground and pushes dynamic bodies. The new position applies at the next
   * step(). The returned object is reused by the next call.
   */
  moveCharacter(h: BodyHandle, desired: Vec3Like, yaw: number): CharacterMove;
  /** Teleport a character (spawn, respawn, leaving a vehicle) without sweeping through the world. */
  placeCharacter(h: BodyHandle, position: Vec3Like, yaw: number): void;

  readonly bodyCount: number;
  dispose(): void;
}
