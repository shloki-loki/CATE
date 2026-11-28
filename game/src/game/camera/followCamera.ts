import { MathUtils, Vector3 } from 'three';
import type { Entity } from '../../core';
import { CollisionGroup } from '../../physics';
import type { GameSystem, GameWorld } from '../../services';
import { CameraRig, CameraTarget, PrevTransform, Transform, type CameraRigData } from '../components';

/**
 * Third-person follow camera (T0016 §3.5): a spring arm behind the target that
 * - turns with the mouse (yaw/pitch on the CameraRig component, written in preSim),
 * - follows the *interpolated* target position, with light smoothing (tighter
 *   horizontally than vertically, so jumps and steps do not jolt the view),
 * - sweeps a sphere from the pivot to the camera against WORLD_STATIC and pulls in
 *   instantly when a wall or the ground is in the way, then eases back out,
 * - optionally swings behind the target's heading after a pause in mouse look (cars).
 *
 * When the followed entity carries CameraTarget { preset: 'vehicle' } (the player is
 * driving), the vehicle chase camera (chaseCamera.ts, T0020) owns the view and this rig
 * stands by. On the way back (getting out) it starts from wherever the chase camera
 * left the view, so the hand-over does not jump.
 */

export const FOLLOW = {
  /** Radians per mouse pixel at sensitivity 1. */
  mouseRadPerPx: 0.0035,
  minPitch: -0.45,
  maxPitch: 1.25,
  /** Zoom step per wheel notch (fraction of the distance). */
  zoomStep: 0.12,
  /** Smoothing rates, 1/s (higher = tighter). */
  followRateXZ: 22,
  followRateY: 9,
  angleRate: 28,
  /** How fast the arm grows back after an obstruction clears, 1/s. */
  armReturnRate: 4,
  /** Sphere radius kept clear around the camera, metres (near plane is 0.1 m). */
  probeRadius: 0.22,
  /** Never closer to the pivot than this, metres. */
  minArm: 0.35,
  /** Seconds without mouse look before auto-recentre starts. */
  recenterDelay: 1.6,
  recenterRate: 2.2,
  /** On-foot field of view, degrees. The chase camera widens it with speed; we ease it back. */
  fov: 60,
  fovRate: 3,
} as const;

/** Unit vector from the pivot toward the camera for a rig yaw/pitch. */
export function armDirection(yaw: number, pitch: number, out: Vector3): Vector3 {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

function wrap(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Yaw (about +Y) of a quaternion's local -Z axis, i.e. the camera yaw that sits behind it. */
function headingYaw(q: { x: number; y: number; z: number; w: number }): number {
  // Rotate (0, 0, -1) by q; only x and z are needed.
  const { x, y, z, w } = q;
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}

/**
 * Smoothed camera state, independent of ECS and physics so it can be unit-tested.
 * `cast(from, dir, dist)` returns the free distance along dir, or null if clear.
 */
export class FollowCameraState {
  readonly pivot = new Vector3();
  readonly position = new Vector3();
  yaw = 0;
  pitch = 0;
  arm = 0;
  private initialised = false;
  private readonly dir = new Vector3();

  /** Jump straight to the target (first frame, teleports, target switch). */
  snap(target: Vector3, rig: CameraRigData): void {
    this.pivot.copy(target).setY(target.y + rig.height);
    this.yaw = rig.yaw;
    this.pitch = rig.pitch;
    this.arm = rig.distance;
    this.initialised = true;
  }

  update(
    target: Vector3,
    rig: CameraRigData,
    dt: number,
    cast: (from: Vector3, dir: Vector3, dist: number) => number | null,
  ): Vector3 {
    if (!this.initialised || this.pivot.distanceToSquared(target) > 30 * 30) this.snap(target, rig);
    const kxz = 1 - Math.exp(-FOLLOW.followRateXZ * dt);
    const ky = 1 - Math.exp(-FOLLOW.followRateY * dt);
    const ka = 1 - Math.exp(-FOLLOW.angleRate * dt);
    this.pivot.x += (target.x - this.pivot.x) * kxz;
    this.pivot.z += (target.z - this.pivot.z) * kxz;
    this.pivot.y += (target.y + rig.height - this.pivot.y) * ky;
    this.yaw = wrap(this.yaw + wrap(rig.yaw - this.yaw) * ka);
    this.pitch += (rig.pitch - this.pitch) * ka;

    armDirection(this.yaw, this.pitch, this.dir);
    const free = cast(this.pivot, this.dir, rig.distance);
    const blocked = free !== null && free < rig.distance;
    const wanted = blocked ? Math.max(FOLLOW.minArm, free) : rig.distance;
    // Something in the way: pull in at once (never show the inside of a wall).
    // Otherwise (obstruction cleared, zoom, hand-over from another camera) ease to the wanted length.
    if (blocked && wanted < this.arm) this.arm = wanted;
    else this.arm += (wanted - this.arm) * (1 - Math.exp(-FOLLOW.armReturnRate * dt));
    return this.position.copy(this.pivot).addScaledVector(this.dir, this.arm);
  }
}

/** The entity the camera should look at for a rig on `owner`. */
function followTarget(world: GameWorld, owner: Entity, rig: CameraRigData): Entity {
  return rig.follow !== null && world.isAlive(rig.follow) && world.has(rig.follow, Transform)
    ? rig.follow
    : owner;
}

/** True while the chase camera drives the view (the rig follows a vehicle CameraTarget). */
export function chaseCameraOwnsView(world: GameWorld, owner: Entity, rig: CameraRigData): boolean {
  const te = followTarget(world, owner, rig);
  return te !== owner && world.get(te, CameraTarget)?.preset === 'vehicle';
}

/**
 * Point the rig (and snap the smoothed state) so the camera stays where it is now,
 * looking at `target`: used when taking the view back from another camera.
 */
export function adoptCamera(
  state: FollowCameraState,
  rig: CameraRigData,
  camera: Vector3,
  target: Vector3,
): void {
  const dx = camera.x - target.x;
  const dz = camera.z - target.z;
  const dy = camera.y - (target.y + rig.height);
  const flat = Math.hypot(dx, dz);
  if (flat > 1e-3) rig.yaw = Math.atan2(dx, dz);
  rig.pitch = MathUtils.clamp(Math.atan2(dy, Math.max(flat, 1e-3)), FOLLOW.minPitch, FOLLOW.maxPitch);
  rig.lookIdle = 0;
  state.snap(target, rig);
  // Start the arm at the current distance; it eases to the rig's distance from there.
  state.arm = Math.max(FOLLOW.minArm, Math.hypot(flat, dy));
}

/**
 * Follow-camera systems: `followCamera.control` (preSim, add before the player's control
 * system) and `followCamera.view` (camera phase). Drives the rig on the first entity with
 * a CameraRig.
 */
export function FollowCameraSystems(state = new FollowCameraState()): GameSystem[] {
  const target = new Vector3();
  /** Set while another camera owns the view; the next frame we own it, we adopt its pose. */
  let standingBy = false;

  const control: GameSystem = {
    name: 'followCamera.control',
    phase: 'preSim',
    update(world, s, dt) {
      const owner = world.query(CameraRig, Transform)[0];
      if (owner === undefined) return;
      const rig = world.require(owner, CameraRig);
      if (chaseCameraOwnsView(world, owner, rig)) return;
      const i = s.input;
      const sens = FOLLOW.mouseRadPerPx * s.settings.values.mouseSensitivity;
      const invert = s.settings.values.invertY ? -1 : 1;
      const lx = i.axis('lookX');
      const ly = i.axis('lookY');
      const zoom = i.axis('zoom');
      rig.yaw = wrap(rig.yaw - lx * sens);
      rig.pitch = MathUtils.clamp(rig.pitch + ly * sens * invert, FOLLOW.minPitch, FOLLOW.maxPitch);
      if (zoom)
        rig.distance = MathUtils.clamp(
          rig.distance * (1 + zoom * FOLLOW.zoomStep),
          rig.minDistance,
          rig.maxDistance,
        );
      rig.lookIdle = lx || ly ? 0 : rig.lookIdle + dt;

      if (rig.autoRecenter && rig.lookIdle > FOLLOW.recenterDelay) {
        const t = world.get(followTarget(world, owner, rig), Transform);
        if (t) {
          const k = 1 - Math.exp(-FOLLOW.recenterRate * dt);
          rig.yaw = wrap(rig.yaw + wrap(headingYaw(t.quaternion) - rig.yaw) * k);
        }
      }
    },
  };

  const view: GameSystem = {
    name: 'followCamera.view',
    phase: 'camera',
    update(world, s, dt) {
      const owner = world.query(CameraRig, Transform)[0];
      if (owner === undefined) return;
      const rig = world.require(owner, CameraRig);
      if (chaseCameraOwnsView(world, owner, rig)) {
        standingBy = true;
        return;
      }
      const te = followTarget(world, owner, rig);
      const curr = world.require(te, Transform);
      const prev = world.get(te, PrevTransform) ?? curr;
      // Switching target (getting into a car) glides over; teleports > 30 m snap inside update().
      target.lerpVectors(prev.position, curr.position, s.clock.alpha);
      if (standingBy) {
        standingBy = false;
        adoptCamera(state, rig, s.render.camera.position, target);
      }
      const pos = state.update(target, rig, Math.min(dt, 0.1), (from, dir, dist) => {
        const hit = s.physics.castSphere(from, dir, FOLLOW.probeRadius, dist, CollisionGroup.WORLD_STATIC);
        return hit ? hit.distance : null;
      });
      const cam = s.render.camera;
      cam.position.copy(pos);
      cam.lookAt(state.pivot);
      if (Math.abs(cam.fov - FOLLOW.fov) > 0.05) {
        cam.fov += (FOLLOW.fov - cam.fov) * (1 - Math.exp(-FOLLOW.fovRate * Math.min(dt, 0.1)));
        cam.updateProjectionMatrix();
      }
    },
  };

  return [control, view];
}
