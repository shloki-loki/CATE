import { MathUtils, Vector3 } from 'three';
import { CollisionGroup } from '../../physics';
import type { GameSystem } from '../../services';

/**
 * Debug orbit camera for the skeleton scene. T0020/T0021 replace it with the
 * follow cameras (spring arm, collision, on-foot/in-car presets).
 *
 * A raycast "spring arm" keeps the camera out of buildings.
 * Input is read in the sim (preSim) so mouse deltas are consumed exactly once per
 * poll; the camera phase only smooths and positions the camera.
 */
export interface OrbitState {
  target: Vector3;
  yaw: number;
  pitch: number;
  distance: number;
  idleSeconds: number;
}

export function createOrbitState(): OrbitState {
  // Start above the north-south road, looking at the central crossing.
  return { target: new Vector3(0, 3, 0), yaw: 0, pitch: 0.38, distance: 60, idleSeconds: 0 };
}

export function OrbitCameraSystem(state: OrbitState = createOrbitState()): GameSystem[] {
  const smoothed = { yaw: state.yaw, pitch: state.pitch, distance: state.distance };
  const forward = new Vector3();
  const right = new Vector3();
  const dir = new Vector3();

  const control: GameSystem = {
    name: 'orbitCamera.control',
    phase: 'preSim',
    update(_w, s, dt) {
      const i = s.input;
      const sens = 0.005 * s.settings.values.mouseSensitivity;
      const invert = s.settings.values.invertY ? -1 : 1;
      const lx = i.axis('lookX');
      const ly = i.axis('lookY');
      const zoom = i.axis('zoom');
      const mx = i.axis('moveX');
      const my = i.axis('moveY');

      state.yaw -= lx * sens;
      state.pitch = MathUtils.clamp(state.pitch + ly * sens * invert, 0.08, 1.45);
      state.distance = MathUtils.clamp(state.distance * (1 + zoom * 0.1), 8, 260);

      if (mx || my) {
        const speed = (i.down('sprint') ? 60 : 25) * dt;
        forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
        right.set(-forward.z, 0, forward.x);
        state.target.addScaledVector(forward, my * speed).addScaledVector(right, mx * speed);
        state.target.x = MathUtils.clamp(state.target.x, -180, 180);
        state.target.z = MathUtils.clamp(state.target.z, -180, 180);
      }

      const active = lx || ly || zoom || mx || my;
      state.idleSeconds = active ? 0 : state.idleSeconds + dt;
      // Slow showcase rotation after 4 s without input.
      if (state.idleSeconds > 4) state.yaw += dt * 0.08;
    },
  };

  const view: GameSystem = {
    name: 'orbitCamera.view',
    phase: 'camera',
    update(_w, s, dt) {
      const k = 1 - Math.exp(-dt * 10);
      smoothed.yaw += (state.yaw - smoothed.yaw) * k;
      smoothed.pitch += (state.pitch - smoothed.pitch) * k;
      smoothed.distance += (state.distance - smoothed.distance) * k;
      const cam = s.render.camera;
      const cp = Math.cos(smoothed.pitch);
      dir.set(Math.sin(smoothed.yaw) * cp, Math.sin(smoothed.pitch), Math.cos(smoothed.yaw) * cp);
      // Spring arm: pull the camera in front of any building between it and the target.
      let dist = smoothed.distance;
      const hit = s.physics.raycast(state.target, dir, dist, CollisionGroup.WORLD_STATIC);
      if (hit) dist = Math.max(1, hit.distance - 0.5);
      cam.position.copy(state.target).addScaledVector(dir, dist);
      cam.lookAt(state.target);
    },
  };

  return [control, view];
}
