import { Quaternion, Vector3 } from 'three';
import type { Entity } from '../../core';
import type { BodyHandle } from '../../physics';
import type { GameSystem } from '../../services';
import {
  Driver,
  RigidBody,
  Transform,
  Vehicle,
  VehicleControl,
  VehicleParts,
  VehicleTelemetry,
} from '../components';
import { getVehicleDef } from './defs';
import { createDriveScratch, poseWheelParts, vehicleDriveTick } from './driveTick';

/** Damage per N*s of impulse above the vehicle's threshold. */
const DAMAGE_PER_IMPULSE = 0.01;
/**
 * Contacts weaker than this (N*s per tick) are not reported as `collision` events: a car
 * pushing against a wall at full throttle produces ~40-200 N*s every tick, while a real
 * knock (a 1.4 t car losing ~0.2 m/s in one tick) is above it.
 */
export const COLLISION_EVENT_MIN_IMPULSE = 250;
/** Max speed (m/s) at which the player may reset (right) the car. */
const RESET_MAX_SPEED = 4;

/**
 * preSim: the player's keyboard/gamepad actions become VehicleControl for the vehicle
 * whose Driver is 'player'. Empty vehicles ('none') hold the handbrake.
 * AI drivers ('ai') write VehicleControl themselves (later task).
 */
export const VehiclePlayerInputSystem: GameSystem = {
  name: 'vehicle.playerInput',
  phase: 'preSim',
  update(world, s) {
    for (const e of world.query(Vehicle, VehicleControl, Driver)) {
      const mode = world.require(e, Driver).mode;
      const c = world.require(e, VehicleControl);
      if (mode === 'player') {
        c.throttle = s.input.axis('throttle');
        c.brake = s.input.axis('brake');
        c.steer = s.input.axis('steer');
        c.handbrake = s.input.down('handbrake');
      } else if (mode === 'none') {
        c.throttle = c.brake = c.steer = 0;
        c.handbrake = true;
      }
    }
  },
};

/**
 * preSim: R rights the player's car (keeps heading, lifts it slightly, stops it).
 * Only when nearly stopped, so it cannot be used as a mid-air recovery.
 */
export function VehicleResetSystem(): GameSystem {
  const up = new Vector3(0, 1, 0);
  const fwd = new Vector3();
  const q = new Quaternion();
  const zero = { x: 0, y: 0, z: 0 };
  return {
    name: 'vehicle.reset',
    phase: 'preSim',
    update(world, s) {
      if (!s.input.pressed('reset')) return;
      for (const e of world.query(Vehicle, Driver, Transform, RigidBody, VehicleTelemetry)) {
        if (world.require(e, Driver).mode !== 'player') continue;
        if (world.require(e, VehicleTelemetry).velocity.length() > RESET_MAX_SPEED) continue;
        const t = world.require(e, Transform);
        fwd.set(0, 0, 1).applyQuaternion(t.quaternion);
        const yaw = Math.atan2(fwd.x, fwd.z);
        q.setFromAxisAngle(up, yaw);
        const body = world.require(e, RigidBody).handle;
        s.physics.setTransform(body, {
          position: t.position.clone().setY(Math.max(t.position.y, 0) + 0.6),
          quaternion: q,
        });
        s.physics.setVelocity(body, zero, zero);
      }
    },
  };
}

/**
 * preSim: read each vehicle's physics state into VehicleTelemetry, run the DriveController
 * and send the wheel commands to physics. Also applies aerodynamic drag and rolling
 * resistance, which the raycast vehicle does not model.
 */
export function VehicleDriveSystem(): GameSystem {
  const scratch = createDriveScratch(4);
  return {
    name: 'vehicle.drive',
    phase: 'preSim',
    update(world, s, dt) {
      for (const e of world.query(Vehicle, VehicleControl, VehicleTelemetry, RigidBody)) {
        const v = world.require(e, Vehicle);
        vehicleDriveTick(
          s.physics,
          getVehicleDef(v.defId),
          v.handle,
          world.require(e, RigidBody).handle,
          world.require(e, VehicleControl),
          world.require(e, VehicleTelemetry),
          v.health <= 0,
          dt,
          scratch,
        );
      }
    },
  };
}

/**
 * postSim: turn physics contacts into `collision` events (entity vs entity, or entity vs
 * static world) and apply collision damage to vehicles. A wrecked vehicle (health 0)
 * loses drive and emits `death`.
 */
export function VehicleCollisionSystem(): GameSystem {
  const byBody = new Map<BodyHandle, Entity>();
  return {
    name: 'vehicle.collisions',
    phase: 'postSim',
    update(world, s) {
      const contacts = s.physics.contacts;
      if (contacts.length === 0) return;
      byBody.clear();
      for (const e of world.query(RigidBody)) byBody.set(world.require(e, RigidBody).handle, e);
      for (const c of contacts) {
        let a = c.a === null ? undefined : byBody.get(c.a);
        let b = c.b === null ? undefined : byBody.get(c.b);
        if (a === undefined && b === undefined) continue;
        if (a === undefined) [a, b] = [b, a];
        const ea = a as Entity;
        const eb = b ?? null;
        if (c.impulse < COLLISION_EVENT_MIN_IMPULSE) continue;
        s.events.emit('collision', { a: ea, b: eb, impulse: c.impulse, point: c.point });
        for (const [target, other] of [
          [ea, eb],
          [eb, ea],
        ] as const) {
          if (target === null) continue;
          const v = world.get(target, Vehicle);
          if (!v || v.health <= 0) continue;
          const def = getVehicleDef(v.defId);
          const over = c.impulse - def.damageThreshold;
          if (over <= 0) continue;
          const amount = Math.min(v.health, over * DAMAGE_PER_IMPULSE);
          v.health -= amount;
          s.events.emit('damage', { target, amount, source: other, kind: 'collision' });
          if (v.health <= 0) s.events.emit('death', { entity: target, cause: 'wrecked' });
        }
      }
    },
  };
}

/** render: place wheels (suspension travel, steering, spin) and light the brake lights. */
export const VehiclePartsSystem: GameSystem = {
  name: 'vehicle.parts',
  phase: 'render',
  update(world) {
    for (const e of world.query(VehicleParts, VehicleTelemetry)) {
      poseWheelParts(world.require(e, VehicleParts), world.require(e, VehicleTelemetry));
    }
  },
};

/** All vehicle systems in the order main.ts should add them (after PhysicsSyncSystem). */
export function VehicleSystems(): GameSystem[] {
  return [
    VehiclePlayerInputSystem,
    VehicleResetSystem(),
    VehicleDriveSystem(),
    VehicleCollisionSystem(),
    VehiclePartsSystem,
  ];
}
