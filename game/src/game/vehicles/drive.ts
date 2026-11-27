import type { WheelControl } from '../../physics';
import type { DriveState, VehicleControlData } from '../components';
import { isDriven, isFront, isLeft, type VehicleDef } from './defs';

/**
 * DriveController (T0016 §3.5): turns driver intent (throttle/brake/steer/handbrake from
 * the player or AI) into per-wheel engine force, brake force and steering angle.
 *
 * Pure and allocation-free per tick (writes into `out`), so it is unit-tested without
 * physics. Model:
 * - engine torque from an interpolated torque curve, with clutch slip at launch, a rev
 *   limiter and closed-throttle engine braking;
 * - automatic gearbox with shift points and a short torque cut while shifting;
 * - holding brake at (near) standstill selects reverse; throttle selects drive again;
 * - brakes split front/rear by bias, rear handbrake with reduced rear side grip;
 * - steering: speed-sensitive lock, rate-limited (keyboard input feels like a wheel),
 *   and Ackermann geometry (inner wheel turns more);
 * - parking brake when the car is stopped with no input, so it does not creep.
 */

const TWO_PI = Math.PI * 2;
const PARK_SPEED = 0.4; // m/s
const REVERSE_ENGAGE_SPEED = 1.0; // m/s
/** Reverse is limited to about 30 km/h, as in a real car's single reverse gear at low revs. */
export const MAX_REVERSE_SPEED = 8.5; // m/s

export function createDriveState(def: VehicleDef): DriveState {
  return { gear: 1, rpm: def.engine.idleRpm, steerAngle: 0, shiftTimer: 0, wrecked: false };
}

export function makeWheelControls(n = 4): WheelControl[] {
  return Array.from({ length: n }, () => ({ engineForce: 0, brakeForce: 0, steering: 0, sideGrip: 1 }));
}

/** Engine torque (N*m) at `rpm`, linear between curve points, clamped at the ends. */
export function torqueAt(def: VehicleDef, rpm: number): number {
  const c = def.engine.torqueCurve;
  if (rpm <= c[0]![0]) return c[0]![1];
  for (let i = 1; i < c.length; i++) {
    const [r1, t1] = c[i]!;
    if (rpm <= r1) {
      const [r0, t0] = c[i - 1]!;
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return c[c.length - 1]![1];
}

/** Gear ratio for a gear index: -1 reverse, 1..n forward. */
export function gearRatio(def: VehicleDef, gear: number): number {
  if (gear < 0) return def.gearbox.reverse;
  return def.gearbox.ratios[Math.max(0, Math.min(def.gearbox.ratios.length, gear) - 1)]!;
}

/** Engine rpm implied by road speed in `gear` (no clutch slip). */
export function wheelRpm(def: VehicleDef, speed: number, gear: number): number {
  const wheelRadPerSec = Math.abs(speed) / def.wheelRadius;
  return ((wheelRadPerSec * gearRatio(def, gear) * def.gearbox.finalDrive) / TWO_PI) * 60;
}

/** Current steering lock (rad) at `speed`: full at standstill, halved at halfLockSpeed. */
export function steerLock(def: VehicleDef, speed: number): number {
  return def.steering.maxAngle / (1 + Math.abs(speed) / def.steering.halfLockSpeed);
}

/**
 * One tick. `speed` = signed forward speed (m/s); `grounded` = number of wheels touching.
 * Updates `state` and writes `out` (wheel order FL, FR, RL, RR).
 */
export function driveStep(
  def: VehicleDef,
  input: VehicleControlData,
  speed: number,
  grounded: number,
  state: DriveState,
  dt: number,
  out: WheelControl[],
): WheelControl[] {
  const throttleIn = clamp01(input.throttle);
  const brakeIn = clamp01(input.brake);
  const steerIn = Math.max(-1, Math.min(1, input.steer || 0));
  const gb = def.gearbox;

  // --- Direction: brake at standstill engages reverse, throttle engages drive. ---
  if (state.gear > 0 && brakeIn > 0.1 && throttleIn < 0.1 && speed < REVERSE_ENGAGE_SPEED) state.gear = -1;
  else if (state.gear < 0 && throttleIn > 0.1 && brakeIn < 0.1 && speed > -REVERSE_ENGAGE_SPEED)
    state.gear = 1;
  const reverse = state.gear < 0;
  const drive = reverse ? brakeIn : throttleIn;
  const pedalBrake = reverse ? throttleIn : brakeIn;

  // --- Automatic gearbox (forward gears only). ---
  if (state.shiftTimer > 0) state.shiftTimer = Math.max(0, state.shiftTimer - dt);
  if (!reverse && state.shiftTimer === 0) {
    const r = wheelRpm(def, speed, state.gear);
    if (r > gb.shiftUpRpm && state.gear < gb.ratios.length) {
      state.gear++;
      state.shiftTimer = gb.shiftTime;
    } else if (
      state.gear > 1 &&
      r < gb.shiftDownRpm &&
      wheelRpm(def, speed, state.gear - 1) < gb.shiftUpRpm * 0.92
    ) {
      state.gear--;
      state.shiftTimer = gb.shiftTime * 0.6;
    }
  }

  // --- Engine speed: wheel-driven, with clutch slip at launch so torque is available from rest. ---
  const { idleRpm, redlineRpm } = def.engine;
  const fromWheels = wheelRpm(def, speed, state.gear);
  const launch = idleRpm + drive * (0.45 * redlineRpm - idleRpm);
  const target = Math.min(redlineRpm * 1.02, Math.max(idleRpm, fromWheels, launch));
  state.rpm += (target - state.rpm) * Math.min(1, dt * 12);

  // --- Drive force at the contact patch. ---
  const ratio = gearRatio(def, state.gear) * gb.finalDrive;
  let wheelForce = 0;
  if (!state.wrecked && state.shiftTimer === 0) {
    const overReverse = reverse && speed < -MAX_REVERSE_SPEED;
    if (drive > 0.01 && fromWheels < redlineRpm && !overReverse) {
      wheelForce = (torqueAt(def, state.rpm) * drive * ratio * gb.efficiency) / def.wheelRadius;
    } else if (drive <= 0.01 && Math.abs(speed) > 1) {
      // Closed-throttle engine braking, opposing motion, stronger at high rpm.
      const eb = def.engine.engineBrakeTorque * Math.min(1, state.rpm / redlineRpm);
      wheelForce = -((eb * ratio) / def.wheelRadius) * Math.sign(speed) * (reverse ? -1 : 1);
    }
  }
  if (reverse) wheelForce = -wheelForce;
  const driven = def.drivetrain === 'awd' ? 4 : 2;

  // --- Brakes. ---
  const stopped = Math.abs(speed) < PARK_SPEED && drive < 0.01;
  const brakeTotal = pedalBrake * def.brakes.maxForce;
  const front = (brakeTotal * def.brakes.frontBias) / 2;
  const rear = (brakeTotal * (1 - def.brakes.frontBias)) / 2;
  const hand = input.handbrake ? def.brakes.handbrakeForce / 2 : 0;
  const park = stopped && grounded > 0 ? def.mass * 2 : 0;

  // --- Steering: rate-limited towards a speed-sensitive lock. ---
  const targetSteer = -steerIn * steerLock(def, speed); // +steer (right) => negative (Rapier + is left)
  const towardsCentre =
    Math.abs(targetSteer) < Math.abs(state.steerAngle) || targetSteer * state.steerAngle < 0;
  const rate = (towardsCentre ? def.steering.returnRate : def.steering.rate) * dt;
  state.steerAngle += Math.max(-rate, Math.min(rate, targetSteer - state.steerAngle));

  // Ackermann: the inner front wheel turns tighter than the outer one.
  const a = state.steerAngle;
  let steerL = a;
  let steerR = a;
  if (Math.abs(a) > 1e-4) {
    const radius = def.wheelbase / Math.tan(Math.abs(a));
    const inner = Math.atan(def.wheelbase / (radius - def.track / 2));
    const outer = Math.atan(def.wheelbase / (radius + def.track / 2));
    const s = Math.sign(a);
    // a > 0 turns left: the left wheel is the inner one.
    steerL = s * (a > 0 ? inner : outer);
    steerR = s * (a > 0 ? outer : inner);
  }

  for (let i = 0; i < out.length; i++) {
    const w = out[i]!;
    const f = isFront(i);
    // Rapier ignores a wheel's brake while it has engine force, so braking cuts drive to that
    // wheel (pedal), and the handbrake declutches the rear wheels.
    const declutched = pedalBrake >= 0.1 || (!f && input.handbrake);
    w.engineForce = isDriven(def, i) && !declutched ? wheelForce / driven : 0;
    w.brakeForce = (f ? front : rear + hand) + park;
    w.steering = f ? (isLeft(i) ? steerL : steerR) : 0;
    w.sideGrip = !f && input.handbrake ? def.tyres.handbrakeSideGrip : 1;
  }
  return out;
}

function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0;
}
