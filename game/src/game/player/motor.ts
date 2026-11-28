/**
 * Pure on-foot movement maths (no physics, no scene objects), so it can be unit-tested
 * and tuned in one place. The player systems feed it input and feed its result to
 * PhysicsAPI.moveCharacter.
 */

export const MOTOR = {
  /** Default on-foot speed (a light jog), m/s. */
  runSpeed: 4.6,
  /** With the sprint button held, m/s. */
  sprintSpeed: 7.2,
  /** Ground acceleration toward the wanted speed, m/s². Reaches a jog in ~0.2 s. */
  groundAccel: 24,
  /** Ground deceleration when there is no input, m/s². Stops from a jog in ~0.17 s. */
  groundDecel: 28,
  /** Steering authority in the air, m/s². */
  airAccel: 5,
  /** How fast the body turns to face the move direction (1/s, exponential). */
  turnRate: 14,
  gravity: 22,
  /** Apex of a standing jump, metres (clears a ~1 m wall). */
  jumpHeight: 1.15,
  /** A jump still works this long after walking off a ledge, s. */
  coyoteTime: 0.12,
  /** A jump pressed this long before landing still fires, s. */
  jumpBufferTime: 0.15,
  maxFallSpeed: 50,
  /** Below this the character counts as standing still, m/s. */
  idleSpeed: 0.3,
  /** Interaction reach for vehicles (from the vehicle origin, horizontal), metres. */
  vehicleReach: 3.6,
  /** Falling below this height respawns the character. */
  killY: -30,
} as const;

export function jumpVelocity(height = MOTOR.jumpHeight, gravity = MOTOR.gravity): number {
  return Math.sqrt(2 * gravity * height);
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Turn `from` toward `to` along the shorter way, framerate-independent (rate in 1/s). */
export function turnToward(from: number, to: number, rate: number, dt: number): number {
  const k = 1 - Math.exp(-rate * dt);
  return wrapAngle(from + wrapAngle(to - from) * k);
}

/** Yaw (about +Y, 0 = facing -Z) of a horizontal direction. */
export function yawOf(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/**
 * Camera-relative wish direction from move axes (x = strafe right, y = forward), written
 * into `out` as a horizontal vector of length ≤ 1. Diagonals are not faster.
 */
export function wishDirection(
  moveX: number,
  moveY: number,
  cameraYaw: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const s = Math.sin(cameraYaw);
  const c = Math.cos(cameraYaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  let x = -s * moveY + c * moveX;
  let z = -c * moveY - s * moveX;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  out.x = x;
  out.z = z;
  return out;
}

/**
 * Move the horizontal velocity (vx, vz) toward (tx, tz) by at most `maxDelta`, in place.
 * Constant acceleration toward the target: no overshoot, no jitter.
 */
export function approach(v: { x: number; z: number }, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) {
    v.x = tx;
    v.z = tz;
    return;
  }
  v.x += (dx / d) * maxDelta;
  v.z += (dz / d) * maxDelta;
}
