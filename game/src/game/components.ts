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

/**
 * The running mission as the HUD shows it (T0023). Written by game/missions on one
 * entity, read by game/shared/hud.ts. Same shape as ui's MissionHud.
 */
export interface MissionStatusData {
  id: string;
  /** Bumped whenever the objective changes (the HUD flashes once). */
  revision: number;
  title: string;
  objective: string;
  step: number;
  steps: number;
  target: { x: number; z: number } | null;
  elapsed: number | null;
  banner: string | null;
}
export const MissionStatus = defineComponent<MissionStatusData>('MissionStatus');

/**
 * The player's wanted level (T0028). One entity, written by game/wanted, read by the HUD
 * bridge. `stars` is what the HUD shows (0..5); `heat` is the exact score behind it.
 */
export interface WantedLevelData {
  /** 0..MAX_WANTED_STARS, always floor(heat) capped at the maximum. */
  stars: number;
  heat: number;
  /** Seconds since the last offence. */
  quiet: number;
  /** Seconds until the next star is lost, or null at zero stars. */
  coolDownIn: number | null;
  /** Bumped whenever the star count goes up (the HUD flashes once). */
  revision: number;
  /** Offences counted since boot (each counted crash is one). */
  offences: number;
}
export const WantedLevel = defineComponent<WantedLevelData>('WantedLevel');

/**
 * The player's own health (T0028), separate from their car's damage. One entity with
 * this marker and a Health component, created by game/shared's PlayerHealthSystem
 * until the on-foot character (T0021/T0026) owns its Health.
 */
export const PlayerRecord = defineComponent<{ maxHp: number; maxArmor: number; hurtAt: number }>(
  'PlayerRecord',
);
