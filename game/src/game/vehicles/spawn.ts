import { Quaternion, Vector3 } from 'three';
import type { Entity } from '../../core';
import { CollisionGroup, type VehicleDesc } from '../../physics';
import type { GameWorld, Services } from '../../services';
import {
  CameraTarget,
  Driver,
  makeTransform,
  PrevTransform,
  RigidBody,
  Transform,
  Vehicle,
  VehicleControl,
  VehicleParts,
  VehicleTelemetry,
  View,
} from '../components';
import { getVehicleDef, isFront, wheelConnection, type VehicleDef } from './defs';
import { createDriveState } from './drive';
import { vehicleView } from './vehicleView';

/** Physics description of a vehicle def (chassis box, low centre of mass, four wheels). */
export function vehicleDesc(
  def: VehicleDef,
  position: { x: number; y: number; z: number },
  yaw: number,
): VehicleDesc {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  // The collider covers the body from the ground clearance up; slightly narrower than
  // the model so cars can squeeze past each other, and shorter on top so the roof
  // never decides a rollover.
  const bodyH = def.height - def.groundClearance;
  const he = { x: def.width / 2 - 0.03, y: (bodyH * 0.85) / 2, z: def.length / 2 };
  return {
    position,
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
    chassisHalfExtents: he,
    chassisOffset: { x: 0, y: def.groundClearance + he.y, z: 0 },
    mass: def.mass,
    centerOfMass: { x: 0, y: def.comHeight, z: 0 },
    friction: 0.45,
    restitution: 0.15,
    angularDamping: 0.4,
    contactForceThreshold: 2_000,
    group: CollisionGroup.VEHICLE,
    wheels: [0, 1, 2, 3].map((i) => ({
      connection: wheelConnection(def, i),
      radius: def.wheelRadius,
      restLength: def.suspension.restLength,
      maxTravel: def.suspension.maxTravel,
      stiffness: def.suspension.stiffness,
      compression: def.suspension.compression,
      relaxation: def.suspension.relaxation,
      frictionSlip: def.tyres.grip,
      sideFrictionStiffness: isFront(i) ? def.tyres.sideFront : def.tyres.sideRear,
      maxSuspensionForce: def.suspension.maxForce,
    })),
  };
}

export interface SpawnOptions {
  /** 'player' reads keyboard input and gets the follow camera. Default 'none' (parked). */
  driver?: 'player' | 'ai' | 'none';
  /** Heading in radians about +Y; 0 faces +Z. */
  yaw?: number;
  /** Skip creating the scene object (headless tests). Default false. */
  headless?: boolean;
}

/** Create a drivable vehicle entity standing on the ground at (x, y, z). */
export function spawnVehicle(
  world: GameWorld,
  s: Services,
  defId: string,
  x: number,
  y: number,
  z: number,
  opts: SpawnOptions = {},
): Entity {
  const def = getVehicleDef(defId);
  const yaw = opts.yaw ?? 0;
  // Spawn with the wheels just touching (static sag is a few centimetres).
  const { vehicle, body } = s.physics.createVehicle(vehicleDesc(def, { x, y: y + 0.05, z }, yaw));

  const e = world.createEntity();
  const t = makeTransform();
  s.physics.getTransform(body, t);
  world.add(e, Transform, t);
  world.add(e, PrevTransform, { position: t.position.clone(), quaternion: t.quaternion.clone() });
  world.add(e, RigidBody, { handle: body });
  world.add(e, Vehicle, {
    defId,
    handle: vehicle,
    health: def.maxHealth,
    maxHealth: def.maxHealth,
    occupants: [],
  });
  world.add(e, VehicleControl, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  world.add(e, VehicleTelemetry, {
    drive: createDriveState(def),
    speed: 0,
    velocity: new Vector3(),
    wheelsInContact: 0,
    braking: false,
    suspension: [0, 1, 2, 3].map(() => def.suspension.restLength),
    spin: [0, 0, 0, 0],
    steer: [0, 0, 0, 0],
  });
  const driver = opts.driver ?? 'none';
  world.add(e, Driver, { mode: driver });
  if (driver === 'player') world.add(e, CameraTarget, { preset: 'vehicle' });

  if (!opts.headless) {
    const v = vehicleView(def);
    v.root.position.copy(t.position);
    v.root.quaternion.copy(t.quaternion);
    world.add(e, View, { object3D: v.root });
    world.add(e, VehicleParts, {
      wheelPivots: v.wheelPivots,
      wheelSpinners: v.wheelSpinners,
      mounts: v.mounts,
      brakeLights: v.brakeLights,
    });
    s.render.addToWorld(v.root, 'dynamic');
  }
  return e;
}

/** Remove a vehicle entity, its physics and its view. */
export function despawnVehicle(world: GameWorld, s: Services, e: Entity): void {
  const v = world.get(e, Vehicle);
  if (v) s.physics.removeVehicle(v.handle);
  const view = world.get(e, View);
  if (view) s.render.remove(view.object3D);
  world.destroyEntity(e);
}
