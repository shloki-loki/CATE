import { MathUtils, Vector3 } from 'three';
import { CollisionGroup } from '../../physics';
import type { GameSystem } from '../../services';
import { CameraTarget, PrevTransform, Transform, VehicleTelemetry } from '../components';

/**
 * In-car follow camera (T0016 §3.5 "Camera", T0020 part). Follows the entity with
 * CameraTarget { preset: 'vehicle' }:
 * - trails behind the car's heading with smoothing, so turns feel weighty;
 * - pulls back and widens the FOV with speed;
 * - mouse drag orbits around the car, and it recenters after a short delay;
 * - a raycast spring arm against WORLD_STATIC keeps it out of buildings.
 * On foot the follow camera (followCamera.ts) drives the view instead; the player module
 * adds CameraTarget to the car the player gets into and removes it on the way out.
 */
export interface ChaseCameraState {
  /** Extra yaw/pitch from mouse look (rad). */
  lookYaw: number;
  lookPitch: number;
  idle: number;
  zoom: number;
}

const BASE_FOV = 62;

export function ChaseCameraSystem(): GameSystem[] {
  const st: ChaseCameraState = { lookYaw: 0, lookPitch: 0, idle: 0, zoom: 1 };
  const smooth = { yaw: 0, distance: 7, fov: BASE_FOV, init: false };
  const pivot = new Vector3();
  const fwd = new Vector3();
  const dir = new Vector3();
  const desired = new Vector3();

  /** The vehicle target, if any (the follow camera owns the view otherwise). */
  const findTarget = (world: Parameters<GameSystem['update']>[0]): number | undefined =>
    world.query(CameraTarget, Transform).find((e) => world.require(e, CameraTarget).preset === 'vehicle');
  let lastTarget: number | undefined;

  const control: GameSystem = {
    name: 'chaseCamera.control',
    phase: 'preSim',
    update(world, s, dt) {
      if (findTarget(world) === undefined) return;
      const i = s.input;
      const sens = 0.005 * s.settings.values.mouseSensitivity;
      const invert = s.settings.values.invertY ? -1 : 1;
      const lx = i.axis('lookX');
      const ly = i.axis('lookY');
      st.lookYaw -= lx * sens;
      st.lookPitch = MathUtils.clamp(st.lookPitch + ly * sens * invert, -0.15, 1.1);
      st.zoom = MathUtils.clamp(st.zoom * (1 + i.axis('zoom') * 0.1), 0.6, 2.5);
      st.idle = lx || ly ? 0 : st.idle + dt;
      if (st.idle > 1.5) {
        // Recenter behind the car.
        const k = 1 - Math.exp(-dt * 2.5);
        st.lookYaw = Math.atan2(Math.sin(st.lookYaw), Math.cos(st.lookYaw)) * (1 - k);
        st.lookPitch *= 1 - k;
      }
    },
  };

  const view: GameSystem = {
    name: 'chaseCamera.view',
    phase: 'camera',
    update(world, s, dt) {
      const target = findTarget(world);
      if (target !== lastTarget) {
        // New car (or back in one): start behind it again instead of swinging from the old pose.
        smooth.init = false;
        st.lookYaw = st.lookPitch = 0;
        st.idle = 0;
        lastTarget = target;
      }
      if (target === undefined) return;
      const t = world.require(target, Transform);
      const prev = world.get(target, PrevTransform) ?? t;
      const tel = world.get(target, VehicleTelemetry);
      const speed = tel ? tel.velocity.length() : 0;
      const a = s.clock.alpha;

      // Interpolated car position (view sync runs after the camera phase).
      pivot.lerpVectors(prev.position, t.position, a);
      pivot.y += 1.4;
      fwd.set(0, 0, 1).applyQuaternion(t.quaternion);
      const heading = Math.atan2(fwd.x, fwd.z);

      if (!smooth.init) {
        smooth.yaw = heading;
        smooth.init = true;
      }
      const k = 1 - Math.exp(-dt * 4);
      let d = heading - smooth.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      smooth.yaw += d * k;

      const distance = (6.5 + Math.min(speed, 45) * 0.07) * st.zoom;
      smooth.distance += (distance - smooth.distance) * k;
      const fov = BASE_FOV + Math.min(speed, 50) * 0.25;
      smooth.fov += (fov - smooth.fov) * (1 - Math.exp(-dt * 3));

      const yaw = smooth.yaw + st.lookYaw;
      const pitch = 0.2 + st.lookPitch;
      const cp = Math.cos(pitch);
      // Camera sits behind the car: opposite the heading.
      dir.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
      let dist = smooth.distance;
      const hit = s.physics.raycast(pivot, dir, dist, CollisionGroup.WORLD_STATIC);
      if (hit) dist = Math.max(1.2, hit.distance - 0.3);
      desired.copy(pivot).addScaledVector(dir, dist);
      if (desired.y < 0.4) desired.y = 0.4;

      const cam = s.render.camera;
      cam.position.copy(desired);
      cam.lookAt(pivot.x, pivot.y + 0.2, pivot.z);
      if (Math.abs(cam.fov - smooth.fov) > 0.05) {
        cam.fov = smooth.fov;
        cam.updateProjectionMatrix();
      }
    },
  };

  return [control, view];
}
