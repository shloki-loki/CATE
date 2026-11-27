import { Quaternion, Vector3, type Object3D } from 'three';
import type { BodyHandle, PhysicsAPI, Transform, VehicleHandle } from '../../physics';
import type { VehicleControlData, VehicleTelemetryData } from '../components';
import { getVehicleDef, type VehicleDef } from './defs';
import { createDriveState } from './drive';
import { createDriveScratch, poseWheelParts, vehicleDriveTick, type DriveScratch } from './driveTick';
import { vehicleDesc } from './spawn';
import { vehicleView, type VehicleViewParts } from './vehicleView';

export interface VehicleOptions {
  /** Where the car stands (ground contact point between the axles). Default the origin. */
  position?: { x: number; y: number; z: number };
  /** Heading in radians about +Y; 0 faces +Z. Default 0. */
  yaw?: number;
  /** Build the Three.js model. Default true; false for headless use (tests, servers). */
  view?: boolean;
}

/** Anything a Three.js object can be added to (a Scene, a Group, ...). */
export interface SceneParent {
  add(obj: Object3D): unknown;
}

/** Max speed (m/s) at which reset() is allowed by `canReset`. */
const RESET_MAX_SPEED = 4;

/**
 * A drivable car as one object (T0025): a Rapier raycast vehicle (chassis rigid body,
 * four wheel rays with spring/damper suspension and tyre friction), the DriveController
 * (engine torque curve, automatic gearbox, reverse, brakes, handbrake, speed-sensitive
 * Ackermann steering), aerodynamic drag and rolling resistance, and its Three.js model
 * with wheels that steer, spin and follow the suspension.
 *
 * It uses exactly the same physics and drive code as the ECS vehicle systems
 * (`spawnVehicle` + `VehicleSystems`), so it can be used without the ECS, for example in
 * a test arena or a tool. Use from a fixed-timestep game loop:
 *
 * ```ts
 * const car = new Vehicle(physics, 'sedan', { position: { x: 0, y: 0, z: 0 } });
 * car.addTo(scene);
 * const loop = new GameLoop({
 *   step(dt) {
 *     car.setInput({ throttle: 1, steer: 0 });
 *     car.update(dt);     // before physics.step
 *     physics.step(dt);
 *     car.postStep();     // after physics.step
 *   },
 *   render(alpha) {
 *     car.syncView(alpha); // interpolates the mesh between the last two ticks
 *     renderer.render(alpha);
 *   },
 * });
 * ```
 *
 * Chassis axes: +X left, +Y up, +Z forward. Steering input: -1 left .. +1 right.
 */
export class Vehicle {
  readonly def: VehicleDef;
  /** Physics handles: the chassis rigid body and the raycast vehicle controller. */
  readonly body: BodyHandle;
  readonly handle: VehicleHandle;
  /** Driver intent, applied on the next update(). */
  readonly input: VehicleControlData = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** Per-tick state for HUD, camera and audio (speed, gear, rpm, wheel contact...). */
  readonly telemetry: VehicleTelemetryData;
  /** Chassis transform after the last postStep(), and the one before it (for interpolation). */
  readonly transform: Transform = { position: new Vector3(), quaternion: new Quaternion() };
  readonly prevTransform: Transform = { position: new Vector3(), quaternion: new Quaternion() };
  /** The Three.js model (null when created with `view: false`). */
  readonly object3D: Object3D | null;
  health: number;
  readonly maxHealth: number;

  private readonly physics: PhysicsAPI;
  private readonly parts: VehicleViewParts | null;
  private readonly scratch: DriveScratch = createDriveScratch(4);
  private disposed = false;

  constructor(physics: PhysicsAPI, defId = 'sedan', opts: VehicleOptions = {}) {
    this.physics = physics;
    this.def = getVehicleDef(defId);
    const p = opts.position ?? { x: 0, y: 0, z: 0 };
    // Spawn with the wheels just touching (static sag is a few centimetres).
    const { vehicle, body } = physics.createVehicle(
      vehicleDesc(this.def, { x: p.x, y: p.y + 0.05, z: p.z }, opts.yaw ?? 0),
    );
    this.body = body;
    this.handle = vehicle;
    this.health = this.maxHealth = this.def.maxHealth;
    this.telemetry = {
      drive: createDriveState(this.def),
      speed: 0,
      velocity: new Vector3(),
      wheelsInContact: 0,
      braking: false,
      suspension: [0, 1, 2, 3].map(() => this.def.suspension.restLength),
      spin: [0, 0, 0, 0],
      steer: [0, 0, 0, 0],
    };
    physics.getTransform(body, this.transform);
    this.copyToPrev();

    this.parts = opts.view === false ? null : vehicleView(this.def);
    this.object3D = this.parts?.root ?? null;
    this.syncView(1);
  }

  /** Set some or all of the driver controls (others keep their value). Values are clamped. */
  setInput(c: Partial<VehicleControlData>): this {
    const i = this.input;
    if (c.throttle !== undefined) i.throttle = clamp(c.throttle, 0, 1);
    if (c.brake !== undefined) i.brake = clamp(c.brake, 0, 1);
    if (c.steer !== undefined) i.steer = clamp(c.steer, -1, 1);
    if (c.handbrake !== undefined) i.handbrake = c.handbrake;
    return this;
  }

  /** Add the model to a scene or group (no-op without a view). */
  addTo(parent: SceneParent): this {
    if (this.object3D) parent.add(this.object3D);
    return this;
  }

  /** Remove the model from whatever it was added to. */
  removeFromScene(): this {
    this.object3D?.removeFromParent();
    return this;
  }

  /**
   * One fixed tick, before physics.step(dt): drive controller, wheel forces, drag.
   * A wrecked car (health <= 0) loses drive but still brakes and steers.
   */
  update(dt: number): void {
    this.assertAlive();
    vehicleDriveTick(
      this.physics,
      this.def,
      this.handle,
      this.body,
      this.input,
      this.telemetry,
      this.health <= 0,
      dt,
      this.scratch,
    );
  }

  /** After physics.step(dt): keep the previous transform and read the new one from the body. */
  postStep(): void {
    this.assertAlive();
    this.copyToPrev();
    this.physics.getTransform(this.body, this.transform);
  }

  /**
   * Once per rendered frame: place the model between the last two ticks (alpha 0..1),
   * and pose the wheels (suspension, steering, spin) and brake lights.
   */
  syncView(alpha = 1): void {
    const o = this.object3D;
    if (!o || !this.parts) return;
    o.position.lerpVectors(this.prevTransform.position, this.transform.position, alpha);
    o.quaternion.slerpQuaternions(this.prevTransform.quaternion, this.transform.quaternion, alpha);
    poseWheelParts(this.parts, this.telemetry);
  }

  /** Signed forward speed in m/s (negative when reversing). */
  get speed(): number {
    return this.telemetry.speed;
  }

  get speedKmh(): number {
    return this.telemetry.speed * 3.6;
  }

  /** -1 reverse, 1..n forward gears. */
  get gear(): number {
    return this.telemetry.drive.gear;
  }

  get rpm(): number {
    return this.telemetry.drive.rpm;
  }

  get position(): Vector3 {
    return this.transform.position;
  }

  get quaternion(): Quaternion {
    return this.transform.quaternion;
  }

  /** Heading in radians, atan2(forward.x, forward.z): 0 faces +Z, turning right lowers it. */
  get heading(): number {
    const f = this.forward(tmp);
    return Math.atan2(f.x, f.z);
  }

  /** World forward (+Z of the chassis). */
  forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.transform.quaternion);
  }

  /** World up of the chassis (y = 1 upright, < 0 upside down). */
  up(out = new Vector3()): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.transform.quaternion);
  }

  /** True when slow enough to be put back on its wheels with reset(). */
  get canReset(): boolean {
    return this.telemetry.velocity.length() <= RESET_MAX_SPEED;
  }

  /**
   * Put the car upright, stopped, at `position` (default: where it is, lifted 0.6 m)
   * facing `yaw` (default: its current heading). Also clears the controls.
   */
  reset(position?: { x: number; y: number; z: number }, yaw = this.heading): void {
    this.assertAlive();
    const p = position
      ? new Vector3(position.x, position.y + 0.05, position.z)
      : this.transform.position.clone().setY(Math.max(this.transform.position.y, 0) + 0.6);
    const q = new Quaternion().setFromAxisAngle(UP, yaw);
    this.physics.setTransform(this.body, { position: p, quaternion: q });
    const zero = { x: 0, y: 0, z: 0 };
    this.physics.setVelocity(this.body, zero, zero);
    this.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    this.physics.getTransform(this.body, this.transform);
    this.copyToPrev();
  }

  /** Reduce health (collision damage, gunfire...). Returns true if this wrecked the car. */
  damage(amount: number): boolean {
    if (this.health <= 0 || !(amount > 0)) return false;
    this.health = Math.max(0, this.health - amount);
    return this.health === 0;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Remove the physics body and the model, and free this car's geometry. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.removeVehicle(this.handle);
    const o = this.object3D;
    if (o) {
      o.removeFromParent();
      // Geometry is per car; materials are shared between cars except the brake lights.
      o.traverse((c) => {
        const g = (c as { geometry?: { dispose(): void } }).geometry;
        g?.dispose();
      });
      this.parts?.brakeLights.dispose();
    }
  }

  private copyToPrev(): void {
    this.prevTransform.position.copy(this.transform.position);
    this.prevTransform.quaternion.copy(this.transform.quaternion);
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error(`Vehicle(${this.def.id}) used after dispose()`);
  }
}

const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();

function clamp(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0;
}
