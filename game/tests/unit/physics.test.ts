import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CollisionGroup, RapierPhysics } from '../../src/physics';

// Runs the real Rapier WASM in Node (no browser needed).
describe('RapierPhysics', () => {
  let p: RapierPhysics;
  beforeAll(async () => {
    p = new RapierPhysics();
    await p.init();
    p.createBody({
      type: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      shapes: [{ kind: 'box', halfExtents: { x: 50, y: 0.5, z: 50 } }],
    });
  });

  it('a dynamic box falls under gravity and comes to rest on the ground', () => {
    const box = p.createBody({
      type: 'dynamic',
      position: { x: 0, y: 10, z: 0 },
      shapes: [{ kind: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }],
    });
    const t = { position: new Vector3(), quaternion: new Quaternion() };
    for (let i = 0; i < 30; i++) p.step(1 / 60);
    p.getTransform(box, t);
    expect(t.position.y).toBeLessThan(10);
    expect(t.position.y).toBeGreaterThan(0.5);
    for (let i = 0; i < 300; i++) p.step(1 / 60);
    p.getTransform(box, t);
    expect(t.position.y).toBeCloseTo(0.5, 1);
    p.removeBody(box);
  });

  it('raycasts down onto the ground and respects the group mask', () => {
    const hit = p.raycast({ x: 3, y: 5, z: 3 }, { x: 0, y: -2, z: 0 }, 100);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(5, 3);
    expect(hit!.point.y).toBeCloseTo(0, 3);
    expect(hit!.normal.y).toBeCloseTo(1, 3);
    expect(p.raycast({ x: 3, y: 5, z: 3 }, { x: 0, y: -1, z: 0 }, 100, CollisionGroup.VEHICLE)).toBeNull();
    expect(p.raycast({ x: 3, y: 5, z: 3 }, { x: 0, y: -1, z: 0 }, 2)).toBeNull();
  });

  it('tracks body count and rejects unknown handles', () => {
    const before = p.bodyCount;
    const h = p.createBody({
      type: 'dynamic',
      position: { x: 5, y: 5, z: 5 },
      shapes: [{ kind: 'sphere', radius: 0.5 }],
    });
    expect(p.bodyCount).toBe(before + 1);
    p.applyImpulse(h, { x: 0, y: 5, z: 0 });
    p.removeBody(h);
    expect(p.bodyCount).toBe(before);
    expect(() => p.getTransform(h, { position: new Vector3(), quaternion: new Quaternion() })).toThrow(
      /unknown body/,
    );
  });
});
