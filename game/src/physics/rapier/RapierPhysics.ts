import RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDesc,
  BodyHandle,
  ContactEvent,
  PhysicsAPI,
  RayHit,
  Transform,
  Vec3,
  VehicleDesc,
  VehicleHandle,
  VehicleState,
  WheelControl,
  WheelDesc,
} from '../PhysicsAPI';
import { ALL_GROUPS, CollisionGroup } from '../PhysicsAPI';

let wasmReady: Promise<void> | null = null;

/** Load Rapier's WASM once per page (the -compat build embeds it, no bundler setup needed). */
export function initRapier(): Promise<void> {
  wasmReady ??= RAPIER.init();
  return wasmReady;
}

/** Rapier's packed interaction groups: membership in the high 16 bits, filter in the low 16. */
export function interactionGroups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

/** Groups the wheel rays hit: ground, props and other cars, not characters, sensors or projectiles. */
const WHEEL_RAY_FILTER = CollisionGroup.WORLD_STATIC | CollisionGroup.PROP | CollisionGroup.VEHICLE;

interface VehicleEntry {
  controller: RAPIER.DynamicRayCastVehicleController;
  body: RAPIER.RigidBody;
  wheels: WheelDesc[];
  /** Commands in game units (brake in N); converted to Rapier's per-step units in step(). */
  controls: WheelControl[];
}

export class RapierPhysics implements PhysicsAPI {
  private world: RAPIER.World | null = null;
  private events: RAPIER.EventQueue | null = null;
  private readonly bodies = new Map<BodyHandle, RAPIER.RigidBody>();
  private readonly vehicles = new Map<VehicleHandle, VehicleEntry>();
  private nextVehicle = 1;
  private readonly contactList: ContactEvent[] = [];

  constructor(private readonly gravity = { x: 0, y: -9.81, z: 0 }) {}

  async init(): Promise<void> {
    await initRapier();
    this.world = new RAPIER.World(this.gravity);
    this.events = new RAPIER.EventQueue(true);
  }

  get version(): string {
    return RAPIER.version();
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  get vehicleCount(): number {
    return this.vehicles.size;
  }

  get contacts(): readonly ContactEvent[] {
    return this.contactList;
  }

  step(dt: number): void {
    const w = this.w();
    w.timestep = dt;
    const filter = interactionGroups(ALL_GROUPS, WHEEL_RAY_FILTER);
    for (const v of this.vehicles.values()) {
      const c = v.controller;
      for (let i = 0; i < v.wheels.length; i++) {
        const cmd = v.controls[i]!;
        const wd = v.wheels[i]!;
        c.setWheelEngineForce(i, cmd.engineForce);
        // Rapier (like Bullet) treats `brake` as the max rolling-friction impulse per step.
        c.setWheelBrake(i, cmd.brakeForce * dt);
        c.setWheelSteering(i, cmd.steering);
        c.setWheelSideFrictionStiffness(i, wd.sideFrictionStiffness * (cmd.sideGrip ?? 1));
      }
      c.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter);
    }
    const q = this.events!;
    w.step(q);
    this.contactList.length = 0;
    q.drainContactForceEvents((e) => {
      const c1 = w.getCollider(e.collider1());
      const c2 = w.getCollider(e.collider2());
      const b1 = c1?.parent();
      const b2 = c2?.parent();
      let point: Vec3 | null = null;
      if (c1 && c2) {
        w.contactPair(c1, c2, (m) => {
          if (point || m.numSolverContacts() === 0) return;
          const p = m.solverContactPoint(0);
          if (p) point = { x: p.x, y: p.y, z: p.z };
        });
      }
      const force = e.totalForceMagnitude();
      this.contactList.push({
        a: b1 ? (b1.handle as BodyHandle) : null,
        b: b2 ? (b2.handle as BodyHandle) : null,
        force,
        impulse: force * dt,
        point,
      });
    });
  }

  createBody(d: BodyDesc): BodyHandle {
    const w = this.w();
    const desc =
      d.type === 'static'
        ? RAPIER.RigidBodyDesc.fixed()
        : d.type === 'kinematic'
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(d.position.x, d.position.y, d.position.z);
    if (d.rotation) desc.setRotation(d.rotation);
    if (d.ccd) desc.setCcdEnabled(true);
    const body = w.createRigidBody(desc);

    const group = d.group ?? (d.type === 'static' ? CollisionGroup.WORLD_STATIC : CollisionGroup.PROP);
    const groups = interactionGroups(group, d.collidesWith ?? ALL_GROUPS);
    for (const s of d.shapes) {
      const cd =
        s.kind === 'box'
          ? RAPIER.ColliderDesc.cuboid(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z)
          : s.kind === 'sphere'
            ? RAPIER.ColliderDesc.ball(s.radius)
            : RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius);
      if (s.offset) cd.setTranslation(s.offset.x, s.offset.y, s.offset.z);
      cd.setCollisionGroups(groups);
      if (d.density !== undefined) cd.setDensity(d.density);
      if (d.friction !== undefined) cd.setFriction(d.friction);
      if (d.restitution !== undefined) cd.setRestitution(d.restitution);
      if (d.contactForceThreshold !== undefined) {
        cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        cd.setContactForceEventThreshold(d.contactForceThreshold);
      }
      w.createCollider(cd, body);
    }
    const h = body.handle as BodyHandle;
    this.bodies.set(h, body);
    return h;
  }

  removeBody(h: BodyHandle): void {
    const b = this.bodies.get(h);
    if (!b) return;
    for (const [vh, v] of this.vehicles) if (v.body === b) return this.removeVehicle(vh);
    this.w().removeRigidBody(b);
    this.bodies.delete(h);
  }

  getTransform(h: BodyHandle, out: Transform): Transform {
    const b = this.body(h);
    const t = b.translation();
    const r = b.rotation();
    out.position.set(t.x, t.y, t.z);
    out.quaternion.set(r.x, r.y, r.z, r.w);
    return out;
  }

  setTransform(h: BodyHandle, t: Transform): void {
    const b = this.body(h);
    const p = t.position;
    const q = t.quaternion;
    if (b.isKinematic()) {
      b.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    } else {
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    }
  }

  applyImpulse(h: BodyHandle, impulse: { x: number; y: number; z: number }): void {
    this.body(h).applyImpulse(impulse, true);
  }

  getLinearVelocity(h: BodyHandle, out: Vec3): Vec3 {
    const v = this.body(h).linvel();
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
    return out;
  }

  setVelocity(h: BodyHandle, linear: Vec3, angular: Vec3): void {
    const b = this.body(h);
    b.setLinvel(linear, true);
    b.setAngvel(angular, true);
  }

  createVehicle(d: VehicleDesc): { vehicle: VehicleHandle; body: BodyHandle } {
    const w = this.w();
    if (d.wheels.length === 0) throw new Error('RapierPhysics: a vehicle needs at least one wheel');
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(d.position.x, d.position.y, d.position.z)
      .setCcdEnabled(true) // fast cars must not tunnel through thin walls
      .setAngularDamping(d.angularDamping ?? 0.3)
      .setCanSleep(false); // the controller drives it every step
    if (d.rotation) desc.setRotation(d.rotation);
    const body = w.createRigidBody(desc);

    const he = d.chassisHalfExtents;
    const off = d.chassisOffset ?? { x: 0, y: 0, z: 0 };
    const com = d.centerOfMass ?? off;
    // Box inertia about its own centre; the lowered centre of mass is what keeps the car upright.
    const m = d.mass;
    const inertia = {
      x: (m / 12) * (4 * he.y * he.y + 4 * he.z * he.z),
      y: (m / 12) * (4 * he.x * he.x + 4 * he.z * he.z),
      z: (m / 12) * (4 * he.x * he.x + 4 * he.y * he.y),
    };
    const cd = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setTranslation(off.x, off.y, off.z)
      .setMassProperties(m, com, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(d.friction ?? 0.5)
      .setRestitution(d.restitution ?? 0.1)
      .setCollisionGroups(interactionGroups(d.group ?? CollisionGroup.VEHICLE, d.collidesWith ?? ALL_GROUPS))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(d.contactForceThreshold ?? 2000);
    w.createCollider(cd, body);

    const controller = w.createVehicleController(body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2; // Rapier 0.21 exposes the forward-axis setter under this name
    d.wheels.forEach((wd, i) => {
      controller.addWheel(
        wd.connection,
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        wd.restLength,
        wd.radius,
      );
      controller.setWheelMaxSuspensionTravel(i, wd.maxTravel);
      controller.setWheelSuspensionStiffness(i, wd.stiffness);
      controller.setWheelSuspensionCompression(i, wd.compression);
      controller.setWheelSuspensionRelaxation(i, wd.relaxation);
      controller.setWheelFrictionSlip(i, wd.frictionSlip);
      controller.setWheelSideFrictionStiffness(i, wd.sideFrictionStiffness);
      controller.setWheelMaxSuspensionForce(i, wd.maxSuspensionForce);
    });

    const bh = body.handle as BodyHandle;
    this.bodies.set(bh, body);
    const vh = this.nextVehicle++ as VehicleHandle;
    this.vehicles.set(vh, {
      controller,
      body,
      wheels: d.wheels.map((x) => ({ ...x, connection: { ...x.connection } })),
      controls: d.wheels.map(() => ({ engineForce: 0, brakeForce: 0, steering: 0, sideGrip: 1 })),
    });
    return { vehicle: vh, body: bh };
  }

  removeVehicle(v: VehicleHandle): void {
    const e = this.vehicles.get(v);
    if (!e) return;
    const w = this.w();
    w.removeVehicleController(e.controller);
    this.bodies.delete(e.body.handle as BodyHandle);
    w.removeRigidBody(e.body);
    this.vehicles.delete(v);
  }

  setVehicleControls(v: VehicleHandle, wheels: readonly WheelControl[]): void {
    const e = this.vehicle(v);
    if (wheels.length !== e.controls.length)
      throw new Error(
        `RapierPhysics: vehicle has ${e.controls.length} wheels, got ${wheels.length} controls`,
      );
    for (let i = 0; i < wheels.length; i++) {
      const src = wheels[i]!;
      const dst = e.controls[i]!;
      dst.engineForce = finiteOr0(src.engineForce);
      dst.brakeForce = Math.max(0, finiteOr0(src.brakeForce));
      dst.steering = finiteOr0(src.steering);
      dst.sideGrip = Math.max(0, src.sideGrip ?? 1);
    }
  }

  getVehicleState(v: VehicleHandle, out: VehicleState): VehicleState {
    const e = this.vehicle(v);
    const c = e.controller;
    const lv = e.body.linvel();
    const av = e.body.angvel();
    out.forwardSpeed = c.currentVehicleSpeed();
    out.velocity.x = lv.x;
    out.velocity.y = lv.y;
    out.velocity.z = lv.z;
    out.angularVelocity.x = av.x;
    out.angularVelocity.y = av.y;
    out.angularVelocity.z = av.z;
    const n = c.numWheels();
    out.wheels.length = n;
    for (let i = 0; i < n; i++) {
      const ws = (out.wheels[i] ??= {
        inContact: false,
        suspensionLength: 0,
        rotation: 0,
        steering: 0,
        forwardImpulse: 0,
        sideImpulse: 0,
        suspensionForce: 0,
      });
      ws.inContact = c.wheelIsInContact(i);
      ws.suspensionLength = c.wheelSuspensionLength(i) ?? e.wheels[i]!.restLength;
      ws.rotation = c.wheelRotation(i) ?? 0;
      ws.steering = c.wheelSteering(i) ?? 0;
      ws.forwardImpulse = c.wheelForwardImpulse(i) ?? 0;
      ws.sideImpulse = c.wheelSideImpulse(i) ?? 0;
      ws.suspensionForce = c.wheelSuspensionForce(i) ?? 0;
    }
    return out;
  }

  raycast(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    mask = ALL_GROUPS,
  ): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len === 0) return null;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const ray = new RAPIER.Ray(from, d);
    const hit = this.w().castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      interactionGroups(ALL_GROUPS, mask),
    );
    if (!hit) return null;
    const parent = hit.collider.parent();
    const t = hit.timeOfImpact;
    return {
      body: parent ? (parent.handle as BodyHandle) : null,
      distance: t,
      point: { x: from.x + d.x * t, y: from.y + d.y * t, z: from.z + d.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  dispose(): void {
    this.events?.free();
    this.events = null;
    this.world?.free();
    this.world = null;
    this.bodies.clear();
    this.vehicles.clear();
    this.contactList.length = 0;
  }

  private w(): RAPIER.World {
    if (!this.world) throw new Error('RapierPhysics: call init() first');
    return this.world;
  }

  private vehicle(v: VehicleHandle): VehicleEntry {
    const e = this.vehicles.get(v);
    if (!e) throw new Error(`RapierPhysics: unknown vehicle ${v}`);
    return e;
  }

  private body(h: BodyHandle): RAPIER.RigidBody {
    const b = this.bodies.get(h);
    if (!b) throw new Error(`RapierPhysics: unknown body ${h}`);
    return b;
  }
}

function finiteOr0(x: number): number {
  return Number.isFinite(x) ? x : 0;
}
