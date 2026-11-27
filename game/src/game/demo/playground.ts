import { Quaternion, Vector3 } from 'three';
import { CollisionGroup } from '../../physics';
import type { Services } from '../../services';
import { blockView } from './demoView';

/**
 * A small on-foot test area next to the player spawn (T0021): stairs, a walkable
 * ramp, a too-steep slope, a ledge you must jump onto, a low roof to bump your head
 * on, and a wall. Everything is a WORLD_STATIC box with a matching view.
 * T0022's procedural city replaces the demo scene, and this with it.
 * Returns the number of static bodies created.
 */
const CONCRETE = 0xd9d4c7;
const PINK = 0xf3a6c0;
const TEAL = 0x7fd6cf;

export function createPlayground(s: Services, ox: number, oz: number): number {
  let bodies = 0;
  const q = new Quaternion();
  const axisX = new Vector3(1, 0, 0);

  const block = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    rotX = 0,
  ): void => {
    q.setFromAxisAngle(axisX, rotX);
    s.physics.createBody({
      type: 'static',
      position: { x: ox + x, y, z: oz + z },
      rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      shapes: [{ kind: 'box', halfExtents: { x: w / 2, y: h / 2, z: d / 2 } }],
      group: CollisionGroup.WORLD_STATIC,
      friction: 0.9,
    });
    const v = blockView(w, h, d, color);
    v.position.set(ox + x, y, oz + z);
    v.quaternion.copy(q);
    s.render.addToWorld(v, 'static');
    bodies++;
  };

  /** Slab whose top surface rises from y = 0 at zLow to y = height at zHigh (zHigh < zLow: rises toward -Z). */
  const ramp = (
    x: number,
    zLow: number,
    zHigh: number,
    height: number,
    width: number,
    color: number,
  ): void => {
    const run = Math.abs(zLow - zHigh);
    const angle = Math.atan2(height, run);
    const len = Math.hypot(run, height) + 0.4;
    const t = 0.3;
    // Rotation about +X by +angle lifts the -Z end; mirror it for ramps rising toward +Z.
    const rot = zHigh < zLow ? angle : -angle;
    const nY = Math.cos(angle);
    const nZ = zHigh < zLow ? Math.sin(angle) : -Math.sin(angle);
    const midZ = (zLow + zHigh) / 2;
    block(x, height / 2 - nY * (t / 2), midZ - nZ * (t / 2), width, t, len, color, rot);
  };

  // Stairs: six 0.25 m steps up to a 1.5 m platform (autostep climbs them).
  for (let i = 0; i < 6; i++) {
    const top = 0.25 * (i + 1);
    block(0, top / 2, -0.25 - i * 0.5, 4, top, 0.5, i % 2 ? CONCRETE : PINK);
  }
  block(0, 0.75, -6.5, 4, 1.5, 7, CONCRETE);
  // ...and a 20° ramp back down to the ground on the far side (walkable both ways).
  ramp(0, -10 - 1.5 / Math.tan((20 * Math.PI) / 180), -10, 1.5, 4, TEAL);

  // A 1 m ledge: too high to step onto, jump onto it (Space).
  block(7, 0.5, -3, 4, 1, 6, PINK);
  // A 60° slope: too steep to climb, you slide back down.
  ramp(13, 0, -2.6, 4.5, 4, TEAL);
  // A shelter with a 2.3 m roof: jumping under it bumps your head.
  for (const [px, pz] of [
    [5.2, -9.2],
    [8.8, -9.2],
    [5.2, -14.8],
    [8.8, -14.8],
  ] as const)
    block(px, 1.15, pz, 0.3, 2.3, 0.3, CONCRETE);
  block(7, 2.45, -12, 4, 0.3, 6, PINK);
  // A 3 m wall to run along (the controller slides along it instead of sticking).
  block(17, 1.5, -10, 0.6, 3, 12, CONCRETE);
  return bodies;
}
