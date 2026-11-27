import RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDesc,
  BodyHandle,
  CharacterDesc,
  CharacterMove,
  PhysicsAPI,
  RayHit,
  Transform,
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

interface CharacterRecord {
  controller: RAPIER.KinematicCharacterController;
  collider: RAPIER.Collider;
  /** Packed query groups used for the movement sweep. */
  filter: number;
  result: CharacterMove;
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/** Rotation of `yaw` radians about +Y, as a Rapier quaternion. */
function yawRotation(yaw: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export class RapierPhysics implements PhysicsAPI {
  private world: RAPIER.World | null = null;
  private readonly bodies = new Map<BodyHandle, RAPIER.RigidBody>();
  private readonly characters = new Map<BodyHandle, CharacterRecord>();
  private readonly balls = new Map<number, RAPIER.Ball>();

  constructor(private readonly gravity = { x: 0, y: -9.81, z: 0 }) {}

  async init(): Promise<void> {
    await initRapier();
    this.world = new RAPIER.World(this.gravity);
  }

  get version(): string {
    return RAPIER.version();
  }

  get bodyCount(): number {
    return this.bodies.size;
  }

  step(dt: number): void {
    const w = this.w();
    w.timestep = dt;
    w.step();
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
      w.createCollider(cd, body);
    }
    const h = body.handle as BodyHandle;
    this.bodies.set(h, body);
    return h;
  }

  removeBody(h: BodyHandle): void {
    const b = this.bodies.get(h);
    if (!b) return;
    const c = this.characters.get(h);
    if (c) {
      this.w().removeCharacterController(c.controller);
      this.characters.delete(h);
    }
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

  castSphere(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    radius: number,
    maxDist: number,
    mask = ALL_GROUPS,
    exclude?: BodyHandle,
  ): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len === 0 || maxDist <= 0) return null;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    let ball = this.balls.get(radius);
    if (!ball) {
      ball = new RAPIER.Ball(radius);
      if (this.balls.size < 32) this.balls.set(radius, ball);
    }
    const hit = this.w().castShape(
      from,
      IDENTITY_ROTATION,
      d,
      ball,
      0,
      maxDist,
      true,
      undefined,
      interactionGroups(ALL_GROUPS, mask),
      undefined,
      exclude === undefined ? undefined : this.bodies.get(exclude),
    );
    if (!hit) return null;
    const parent = hit.collider.parent();
    const t = hit.time_of_impact;
    return {
      body: parent ? (parent.handle as BodyHandle) : null,
      distance: t,
      point: { x: hit.witness1.x, y: hit.witness1.y, z: hit.witness1.z },
      normal: { x: hit.normal1.x, y: hit.normal1.y, z: hit.normal1.z },
    };
  }

  setBodyEnabled(h: BodyHandle, enabled: boolean): void {
    this.body(h).setEnabled(enabled);
  }

  createCharacter(d: CharacterDesc): BodyHandle {
    const w = this.w();
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(d.position.x, d.position.y, d.position.z),
    );
    const group = d.group ?? CollisionGroup.CHARACTER;
    const collidesWith =
      d.collidesWith ?? ALL_GROUPS & ~(CollisionGroup.SENSOR | CollisionGroup.CAMERA_IGNORE);
    const collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(d.halfHeight, d.radius)
        .setCollisionGroups(interactionGroups(group, collidesWith))
        .setFriction(0),
      body,
    );
    // Small skin so the capsule never starts a sweep in contact with the ground.
    const controller = w.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle(((d.maxSlopeDeg ?? 50) * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((((d.maxSlopeDeg ?? 50) + 5) * Math.PI) / 180);
    controller.enableAutostep(d.stepHeight ?? 0.45, Math.max(0.05, d.radius * 0.5), false);
    controller.enableSnapToGround(d.snapDistance ?? 0.35);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(d.mass ?? 80);

    const h = body.handle as BodyHandle;
    this.bodies.set(h, body);
    this.characters.set(h, {
      controller,
      collider,
      filter: interactionGroups(group, collidesWith),
      result: { grounded: false, moved: { x: 0, y: 0, z: 0 }, collisions: 0 },
    });
    // Make the new collider visible to queries before the first step.
    w.propagateModifiedBodyPositionsToColliders();
    return h;
  }

  moveCharacter(h: BodyHandle, desired: { x: number; y: number; z: number }, yaw: number): CharacterMove {
    const c = this.character(h);
    const b = this.body(h);
    const r = c.result;
    if (!b.isEnabled()) {
      r.grounded = false;
      r.moved.x = r.moved.y = r.moved.z = 0;
      r.collisions = 0;
      return r;
    }
    c.controller.computeColliderMovement(
      c.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      c.filter,
    );
    const m = c.controller.computedMovement();
    const p = b.translation();
    b.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
    b.setNextKinematicRotation(yawRotation(yaw));
    r.grounded = c.controller.computedGrounded();
    r.moved.x = m.x;
    r.moved.y = m.y;
    r.moved.z = m.z;
    r.collisions = c.controller.numComputedCollisions();
    return r;
  }

  placeCharacter(h: BodyHandle, position: { x: number; y: number; z: number }, yaw: number): void {
    this.character(h);
    const b = this.body(h);
    const rot = yawRotation(yaw);
    b.setTranslation(position, true);
    b.setRotation(rot, true);
    // Also set the kinematic target, otherwise the next step moves it back to the old target.
    b.setNextKinematicTranslation(position);
    b.setNextKinematicRotation(rot);
    this.w().propagateModifiedBodyPositionsToColliders();
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.bodies.clear();
    this.characters.clear();
    this.balls.clear();
  }

  private character(h: BodyHandle): CharacterRecord {
    const c = this.characters.get(h);
    if (!c) throw new Error(`RapierPhysics: body ${h} is not a character`);
    return c;
  }

  private w(): RAPIER.World {
    if (!this.world) throw new Error('RapierPhysics: call init() first');
    return this.world;
  }

  private body(h: BodyHandle): RAPIER.RigidBody {
    const b = this.bodies.get(h);
    if (!b) throw new Error(`RapierPhysics: unknown body ${h}`);
    return b;
  }
}
