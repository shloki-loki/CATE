import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { defineComponent, type Entity } from '../core';
import type { BodyHandle, VehicleHandle } from '../physics';

/**
 * ALL shared component types live here (T0016 §4.4). Feature folders
 * (game/player, game/vehicles, ...) communicate only through these and game/events.ts.
 * Later tasks add fields/components here in their PRs.
 */

export interface TransformData {
  position: Vector3;
  quaternion: Quaternion;
}

export function makeTransform(x = 0, y = 0, z = 0): TransformData {
  return { position: new Vector3(x, y, z), quaternion: new Quaternion() };
}

/** Current simulation transform (written in postSim from physics, or by gameplay for non-physics entities). */
export const Transform = defineComponent<TransformData>('Transform');
/** Transform at the previous sim tick, for render interpolation. */
export const PrevTransform = defineComponent<TransformData>('PrevTransform');
export const RigidBody = defineComponent<{ handle: BodyHandle }>('RigidBody');
/** The scene object drawn for this entity. Created by a *View.ts factory. */
export const View = defineComponent<{ object3D: Object3D }>('View');
export const Health = defineComponent<{ hp: number; armor: number }>('Health');
export const PlayerTag = defineComponent<Record<string, never>>('PlayerTag');
export const Driver = defineComponent<{ mode: 'player' | 'ai' | 'none' }>('Driver');
/** A raycast vehicle (T0020). `handle` is the physics vehicle; the chassis body is in RigidBody. */
export const Vehicle = defineComponent<{
  defId: string;
  handle: VehicleHandle;
  health: number;
  maxHealth: number;
  occupants: Entity[];
}>('Vehicle');

/** Driver intent for a vehicle, written by player input or AI. steer: -1 left .. +1 right. */
export interface VehicleControlData {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}
export const VehicleControl = defineComponent<VehicleControlData>('VehicleControl');

/** Drivetrain state kept between ticks by the vehicle drive system. gear: -1 reverse, 1..n forward. */
export interface DriveState {
  gear: number;
  rpm: number;
  steerAngle: number;
  shiftTimer: number;
  wrecked: boolean;
}

/** Read-only per-tick vehicle telemetry for HUD, camera, audio and the wheel views. */
export interface VehicleTelemetryData {
  drive: DriveState;
  /** Signed forward speed (m/s) and world velocity. */
  speed: number;
  velocity: Vector3;
  wheelsInContact: number;
  braking: boolean;
  /** Per wheel (FL, FR, RL, RR): suspension length, spin angle, steering angle. */
  suspension: number[];
  spin: number[];
  steer: number[];
}
export const VehicleTelemetry = defineComponent<VehicleTelemetryData>('VehicleTelemetry');

/** Scene parts of a vehicle view that move on their own (created by vehicleView.ts). */
export const VehicleParts = defineComponent<{
  /** Per wheel: pivot (steering + suspension) and the spinning wheel inside it. */
  wheelPivots: Object3D[];
  wheelSpinners: Object3D[];
  /** Chassis-space mount points, for placing the pivots. */
  mounts: { x: number; y: number; z: number }[];
  brakeLights: { emissiveIntensity: number } | null;
}>('VehicleParts');

/** The entity the gameplay camera follows. T0021 adds the 'onFoot' preset. */
export const CameraTarget = defineComponent<{ preset: 'vehicle' | 'onFoot' }>('CameraTarget');
export const Blip = defineComponent<{ icon: string; color: string }>('Blip');
/** Entity is removed together with its streamed chunk. */
export const Streamed = defineComponent<{ chunkId: string }>('Streamed');

/** On-foot states of a character (T0016 §3.5). `aim`/`dead` are driven by the combat task. */
export type CharacterState =
  'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'aim' | 'inVehicle' | 'dead';

/** A kinematic capsule character (player now, pedestrians later). Body = PhysicsAPI.createCharacter. */
export interface CharacterData {
  handle: BodyHandle;
  state: CharacterState;
  /** World-space velocity in m/s actually achieved (horizontal from the last move, vertical from gravity/jumps). */
  velocity: Vector3;
  /**
   * Horizontal velocity it is trying to move at (after acceleration, before collisions).
   * Kept separate from `velocity` so a curb or wall that briefly blocks it does not
   * reset its momentum, which would stop it from stepping up.
   */
  planar: { x: number; z: number };
  grounded: boolean;
  /** Facing, radians about +Y; 0 faces -Z. */
  facing: number;
  /** Seconds since the character last stood on the ground (coyote time). */
  airTime: number;
  /** Seconds left in which a buffered jump press still triggers on landing. */
  jumpBuffer: number;
  /** The vehicle it sits in while state is 'inVehicle'. */
  vehicle: Entity | null;
  /** Nearest thing it could interact with right now, and the prompt to show (HUD reads this). */
  focus: Entity | null;
  prompt: string | null;
  /** Capsule size, for placement and clearance tests. */
  radius: number;
  halfHeight: number;
  /** Where it respawns if it falls out of the world. */
  spawn: Vector3;
}
export const Character = defineComponent<CharacterData>('Character');

/**
 * Follow-camera rig, on the entity the camera belongs to (the player). The camera's
 * control system writes yaw/pitch/distance from mouse input in preSim; movement reads
 * yaw so WASD is camera-relative. `follow` switches the target (e.g. the car the player
 * is driving); presets are changed by whoever owns the mode (player on foot, vehicles in a car).
 */
export interface CameraRigData {
  /** Orbit angle about +Y; 0 puts the camera on +Z looking toward -Z. */
  yaw: number;
  /** Elevation; positive looks down at the target. */
  pitch: number;
  /** Wanted arm length (zoom), metres. */
  distance: number;
  minDistance: number;
  maxDistance: number;
  /** Pivot height above the target's origin. */
  height: number;
  /** Entity to follow instead of the rig's own entity. */
  follow: Entity | null;
  /** Swing the camera behind the target's heading after a few seconds without mouse look. */
  autoRecenter: boolean;
  /** Seconds since the last mouse look. */
  lookIdle: number;
}
export const CameraRig = defineComponent<CameraRigData>('CameraRig');

/** Something the player can use with the interact key (F) when within `radius` metres. */
export const Interactable = defineComponent<{ kind: string; prompt: string; radius: number }>('Interactable');
