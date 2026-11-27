import RAPIER from '@dimforge/rapier3d-compat';
import type { BodyDesc, BodyHandle, PhysicsAPI, RayHit, Transform } from '../PhysicsAPI';
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

export class RapierPhysics implements PhysicsAPI {
  private world: RAPIER.World | null = null;
  private readonly bodies = new Map<BodyHandle, RAPIER.RigidBody>();

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

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.bodies.clear();
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
