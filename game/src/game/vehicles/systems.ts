import { Quaternion, Vector3 } from 'three';
import type { Entity } from '../../core';
import type { BodyHandle, VehicleState } from '../../physics';
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
import { driveStep, makeWheelControls } from './drive';

const AIR_DENSITY = 1.225; // kg/m^3
const G = 9.81;
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
  const state: VehicleState = {
    forwardSpeed: 0,
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    wheels: [],
  };
  const controls = makeWheelControls(4);
  const impulse = { x: 0, y: 0, z: 0 };
  return {
    name: 'vehicle.drive',
    phase: 'preSim',
    update(world, s, dt) {
      for (const e of world.query(Vehicle, VehicleControl, VehicleTelemetry, RigidBody)) {
        const v = world.require(e, Vehicle);
        const def = getVehicleDef(v.defId);
        const tel = world.require(e, VehicleTelemetry);
        const input = world.require(e, VehicleControl);
        s.physics.getVehicleState(v.handle, state);

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
        tel.drive.wrecked = v.health <= 0;

        driveStep(def, input, state.forwardSpeed, grounded, tel.drive, dt, controls);
        tel.braking = tel.drive.gear > 0 ? input.brake > 0.1 : input.throttle > 0.1;
        s.physics.setVehicleControls(v.handle, controls);

        // Drag (all the time) and rolling resistance (wheels on the ground), as impulses.
        const vel = tel.velocity;
        const sp = vel.length();
        if (sp > 0.05) {
          const drag = 0.5 * AIR_DENSITY * def.aero.dragArea * sp; // * v gives the force vector
          const hs = Math.hypot(vel.x, vel.z);
          const roll =
            grounded > 0
              ? (def.aero.rollingResistance * def.mass * G * (grounded / 4)) / Math.max(hs, 0.5)
              : 0;
          impulse.x = -(drag + roll) * vel.x * dt;
          impulse.y = -drag * vel.y * dt;
          impulse.z = -(drag + roll) * vel.z * dt;
          s.physics.applyImpulse(world.require(e, RigidBody).handle, impulse);
        }
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
      const p = world.require(e, VehicleParts);
      const tel = world.require(e, VehicleTelemetry);
      for (let i = 0; i < p.wheelPivots.length; i++) {
        const pivot = p.wheelPivots[i]!;
        const m = p.mounts[i]!;
        pivot.position.set(m.x, m.y - (tel.suspension[i] ?? 0), m.z);
        pivot.rotation.y = tel.steer[i] ?? 0;
        p.wheelSpinners[i]!.rotation.x = tel.spin[i] ?? 0;
      }
      if (p.brakeLights) p.brakeLights.emissiveIntensity = tel.braking ? 2.2 : 0.25;
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
