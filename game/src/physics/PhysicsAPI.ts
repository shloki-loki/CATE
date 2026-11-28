import type { Quaternion, Vector3 } from 'three';

/**
 * Physics contract (T0016 §4.3). Only src/physics/rapier/ talks to Rapier;
 * everyone else uses this interface.
 *
 * T0019 implements bodies, transforms, impulses and raycasts. T0020 adds
 * raycast vehicles (createVehicle/setVehicleControls/getVehicleState), body
 * velocities and contact events. T0021/T0026 add characters
 * (createCharacter/moveCharacter/placeCharacter), setBodyEnabled and the sphere
 * cast used by the follow camera.
 */
export type BodyHandle = number & { readonly __brand: 'Body' };
export type VehicleHandle = number & { readonly __brand: 'Vehicle' };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

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
  /** Report contacts of this body whose summed force exceeds this many newtons (see PhysicsAPI.contacts). */
  contactForceThreshold?: number;
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

/**
 * One wheel of a raycast vehicle, in chassis space. The chassis body's local axes are
 * +X left, +Y up, +Z forward (the glTF convention used by the assets, T0016 §3.8).
 */
export interface WheelDesc {
  /** Suspension mount point (top of the suspension) in chassis space. */
  connection: Vec3;
  radius: number;
  /** Suspension length at rest (m). */
  restLength: number;
  /** Maximum compression from rest (m). */
  maxTravel: number;
  /** Spring stiffness, scaled by chassis mass like Bullet's btRaycastVehicle (typical 20-60). */
  stiffness: number;
  /** Damping while compressing / extending (typical 0.2-0.5 x 2*sqrt(stiffness)). */
  compression: number;
  relaxation: number;
  /** Longitudinal friction coefficient (tyre grip; ~1-2 for road tyres in this model). */
  frictionSlip: number;
  /** Lateral grip relative to longitudinal (1 = same). */
  sideFrictionStiffness: number;
  /** Cap on the suspension force (N). */
  maxSuspensionForce: number;
}

export interface VehicleDesc {
  position: Vec3;
  rotation?: { x: number; y: number; z: number; w: number };
  /** Chassis collision box half extents and its offset from the body origin. */
  chassisHalfExtents: Vec3;
  chassisOffset?: Vec3;
  mass: number;
  /** Centre of mass relative to the body origin. Keep it low for stability. */
  centerOfMass?: Vec3;
  wheels: WheelDesc[];
  friction?: number;
  restitution?: number;
  /** Small angular damping keeps airborne cars from spinning forever. */
  angularDamping?: number;
  /** Contact-force threshold (N) for collision reporting. Default 2000 N. */
  contactForceThreshold?: number;
  group?: number;
  collidesWith?: number;
}

/** Per-wheel command for one tick. Forces are in newtons, steering in radians (+ = left). */
export interface WheelControl {
  engineForce: number;
  brakeForce: number;
  steering: number;
  /** Multiplier on the wheel's side grip this tick (handbrake slides). Default 1. */
  sideGrip?: number;
}

export interface WheelState {
  inContact: boolean;
  /** Current suspension length (m), for drawing the wheel. */
  suspensionLength: number;
  /** Accumulated spin angle (rad). */
  rotation: number;
  steering: number;
  /** Impulses the tyre applied last step (N*s): forward (traction/braking) and sideways (cornering). */
  forwardImpulse: number;
  sideImpulse: number;
  suspensionForce: number;
}

export interface VehicleState {
  /** Signed speed along the chassis forward axis (m/s). */
  forwardSpeed: number;
  /** World-space linear velocity (m/s). */
  velocity: Vec3;
  angularVelocity: Vec3;
  wheels: WheelState[];
}

/** A contact whose force crossed a body's threshold during the last step. */
export interface ContactEvent {
  a: BodyHandle | null;
  b: BodyHandle | null;
  /** Summed contact force magnitude (N) and the matching impulse (N*s = force * dt). */
  force: number;
  impulse: number;
  /** A world-space contact point, if the pair still touches after the step. */
  point: Vec3 | null;
}

type Vec3Like = Vec3;

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
  /** Largest force it can push a dynamic body with, N. Default 600 (a hard shove). */
  pushForce?: number;
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
  /** Writes into `out` and returns it. */
  getLinearVelocity(h: BodyHandle, out: Vec3): Vec3;
  setVelocity(h: BodyHandle, linear: Vec3, angular: Vec3): void;

  /** Raycast vehicle (T0020): a dynamic chassis body plus suspension/tyre rays. */
  createVehicle(d: VehicleDesc): { vehicle: VehicleHandle; body: BodyHandle };
  removeVehicle(v: VehicleHandle): void;
  /** Commands applied on every following step until changed. `wheels[i]` matches VehicleDesc.wheels[i]. */
  setVehicleControls(v: VehicleHandle, wheels: readonly WheelControl[]): void;
  /** Writes into `out` (reusing its arrays) and returns it. */
  getVehicleState(v: VehicleHandle, out: VehicleState): VehicleState;
  /** Contacts reported during the last step() (cleared at the start of each step). */
  readonly contacts: readonly ContactEvent[];
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
  readonly vehicleCount: number;
  dispose(): void;
}
