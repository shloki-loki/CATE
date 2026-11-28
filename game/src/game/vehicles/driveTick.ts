import type { BodyHandle, PhysicsAPI, VehicleHandle, VehicleState, WheelControl } from '../../physics';
import type { VehicleControlData, VehicleTelemetryData } from '../components';
import type { VehicleDef } from './defs';
import { driveStep, makeWheelControls } from './drive';

const AIR_DENSITY = 1.225; // kg/m^3
const G = 9.81;

/** Reusable per-caller buffers for vehicleDriveTick (no allocation per tick). */
export interface DriveScratch {
  state: VehicleState;
  controls: WheelControl[];
  impulse: { x: number; y: number; z: number };
}

export function createDriveScratch(wheels = 4): DriveScratch {
  return {
    state: {
      forwardSpeed: 0,
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      wheels: [],
    },
    controls: makeWheelControls(wheels),
    impulse: { x: 0, y: 0, z: 0 },
  };
}

/**
 * One fixed tick of a raycast vehicle, before physics.step(): read the vehicle's physics
 * state into `tel`, run the DriveController on `input`, send the wheel commands, and apply
 * aerodynamic drag and rolling resistance (which the raycast vehicle does not model).
 *
 * Shared by the ECS VehicleDriveSystem and the standalone `Vehicle` class, so both drive
 * exactly the same way.
 */
export function vehicleDriveTick(
  physics: PhysicsAPI,
  def: VehicleDef,
  handle: VehicleHandle,
  body: BodyHandle,
  input: VehicleControlData,
  tel: VehicleTelemetryData,
  wrecked: boolean,
  dt: number,
  scratch: DriveScratch,
): void {
  const { state, controls, impulse } = scratch;
  physics.getVehicleState(handle, state);

  let grounded = 0;
  for (let i = 0; i < state.wheels.length; i++) {
    const w = state.wheels[i]!;
    if (w.inContact) grounded++;
    tel.suspension[i] = w.suspensionLength;
    tel.spin[i] = w.rotation;
    tel.steer[i] = w.steering;
  }
  tel.speed = state.forwardSpeed;
  tel.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
  tel.wheelsInContact = grounded;
  tel.drive.wrecked = wrecked;

  driveStep(def, input, state.forwardSpeed, grounded, tel.drive, dt, controls);
  tel.braking = tel.drive.gear > 0 ? input.brake > 0.1 : input.throttle > 0.1;
  physics.setVehicleControls(handle, controls);

  // Drag (all the time) and rolling resistance (wheels on the ground), as impulses.
  const vel = tel.velocity;
  const sp = vel.length();
  if (sp > 0.05) {
    const drag = 0.5 * AIR_DENSITY * def.aero.dragArea * sp; // * v gives the force vector
    const hs = Math.hypot(vel.x, vel.z);
    const roll =
      grounded > 0 ? (def.aero.rollingResistance * def.mass * G * (grounded / 4)) / Math.max(hs, 0.5) : 0;
    impulse.x = -(drag + roll) * vel.x * dt;
    impulse.y = -drag * vel.y * dt;
    impulse.z = -(drag + roll) * vel.z * dt;
    physics.applyImpulse(body, impulse);
  }
}

/** Scene parts of a vehicle view that move on their own (see VehicleParts in components.ts). */
export interface WheelParts {
  wheelPivots: { position: { set(x: number, y: number, z: number): unknown }; rotation: { y: number } }[];
  wheelSpinners: { rotation: { x: number } }[];
  mounts: { x: number; y: number; z: number }[];
  brakeLights: { emissiveIntensity: number } | null;
}

/** Place the wheels (suspension travel, steering, spin) and light the brake lights from telemetry. */
export function poseWheelParts(p: WheelParts, tel: VehicleTelemetryData): void {
  for (let i = 0; i < p.wheelPivots.length; i++) {
    const pivot = p.wheelPivots[i]!;
    const m = p.mounts[i]!;
    pivot.position.set(m.x, m.y - (tel.suspension[i] ?? 0), m.z);
    pivot.rotation.y = tel.steer[i] ?? 0;
    p.wheelSpinners[i]!.rotation.x = tel.spin[i] ?? 0;
  }
  if (p.brakeLights) p.brakeLights.emissiveIntensity = tel.braking ? 2.2 : 0.25;
}
