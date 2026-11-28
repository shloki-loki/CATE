// Vehicles (T0020): VehicleDef data, DriveController, spawning, drive/collision/damage systems, view.
// T0025: the standalone `Vehicle` class and the vehicle test arena.
export {
  VEHICLE_DEFS,
  WHEEL_NAMES,
  getVehicleDef,
  isDriven,
  staticSag,
  wheelConnection,
  type BodyStyle,
  type Drivetrain,
  type VehicleDef,
} from './defs';
export {
  MAX_REVERSE_SPEED,
  createDriveState,
  driveStep,
  gearRatio,
  makeWheelControls,
  steerLock,
  torqueAt,
  wheelRpm,
} from './drive';
export {
  createDriveScratch,
  poseWheelParts,
  vehicleDriveTick,
  type DriveScratch,
  type WheelParts,
} from './driveTick';
export { despawnVehicle, spawnVehicle, vehicleDesc, type SpawnOptions } from './spawn';
export {
  COLLISION_EVENT_MIN_IMPULSE,
  VehicleCollisionSystem,
  VehicleDriveSystem,
  VehiclePartsSystem,
  VehiclePlayerInputSystem,
  VehicleResetSystem,
  VehicleSystems,
} from './systems';
export { Vehicle, type SceneParent, type VehicleOptions } from './Vehicle';
export {
  ARENA_DRIVE_SCRIPT,
  ARENA_DRIVE_SECONDS,
  ARENA_START,
  arenaDrivePhase,
  arenaLayout,
  createArenaPhysics,
  type ArenaBox,
  type ArenaLayout,
  type DrivePhase,
} from './arena';
export { arenaView } from './arenaView';
