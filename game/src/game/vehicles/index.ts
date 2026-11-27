// Vehicles (T0020): VehicleDef data, DriveController, spawning, drive/collision/damage systems, view.
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
