import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';

/**
 * Placeholder player mannequin built from primitives (an original design: loud shirt,
 * jeans, sneakers) until T0018 generates the skinned character. The origin is the
 * capsule centre, so the feet are `PLAYER_HALF_TOTAL` below it, and it faces -Z.
 * Limbs hang from pivot groups so a procedural walk cycle can swing them.
 */
export const PLAYER_HALF_TOTAL = 0.9;

const mats = {
  skin: new MeshStandardMaterial({ color: 0xc68a5c, roughness: 0.7 }),
  shirt: new MeshStandardMaterial({ color: 0x19b5a8, roughness: 0.65 }),
  jeans: new MeshStandardMaterial({ color: 0x33415e, roughness: 0.85 }),
  shoe: new MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  hair: new MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 }),
};

interface Limbs {
  armL: Group;
  armR: Group;
  legL: Group;
  legR: Group;
  torso: Group;
  /** Walk-cycle phase (radians), advanced every rendered frame. */
  phase: number;
  /** Smoothed 0..1 airborne pose weight. */
  air: number;
}

const limbs = new WeakMap<Object3D, Limbs>();

function part(geo: BoxGeometry | CapsuleGeometry | SphereGeometry, mat: MeshStandardMaterial): Mesh {
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function limb(x: number, y: number, len: number, radius: number, mat: MeshStandardMaterial): Group {
  const pivot = new Group();
  pivot.position.set(x, y, 0);
  const m = part(new CapsuleGeometry(radius, len - 2 * radius, 4, 8), mat);
  m.position.y = -len / 2;
  pivot.add(m);
  return pivot;
}

export function playerView(): Object3D {
  const root = new Group();
  root.name = 'player';
  const feet = -PLAYER_HALF_TOTAL;

  const legL = limb(-0.11, feet + 0.9, 0.86, 0.085, mats.jeans);
  const legR = limb(0.11, feet + 0.9, 0.86, 0.085, mats.jeans);
  for (const leg of [legL, legR]) {
    const shoe = part(new BoxGeometry(0.15, 0.09, 0.28), mats.shoe);
    shoe.position.set(0, -0.86, -0.05);
    leg.add(shoe);
  }

  const torso = new Group();
  torso.position.y = feet + 0.9;
  const chest = part(new CapsuleGeometry(0.19, 0.3, 4, 10), mats.shirt);
  chest.position.y = 0.3;
  chest.scale.set(1.15, 1, 0.75);
  const head = part(new SphereGeometry(0.13, 16, 12), mats.skin);
  head.position.y = 0.76;
  const hair = part(new SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.hair);
  hair.position.y = 0.78;
  const neck = part(new CapsuleGeometry(0.05, 0.06, 2, 6), mats.skin);
  neck.position.y = 0.62;
  torso.add(chest, neck, head, hair);

  const armL = limb(-0.29, 0.55, 0.66, 0.06, mats.skin);
  const armR = limb(0.29, 0.55, 0.66, 0.06, mats.skin);
  for (const arm of [armL, armR]) {
    const sleeve = part(new CapsuleGeometry(0.075, 0.12, 2, 8), mats.shirt);
    sleeve.position.y = -0.1;
    arm.add(sleeve);
  }
  torso.add(armL, armR);

  root.add(legL, legR, torso);
  limbs.set(root, { armL, armR, legL, legR, torso, phase: 0, air: 0 });
  return root;
}

/**
 * Procedural walk/run cycle. `speed` is horizontal speed (m/s), `airborne` whether it
 * is jumping or falling. Call once per rendered frame with the frame time.
 */
export function animatePlayerView(obj: Object3D, speed: number, airborne: boolean, dt: number): void {
  const l = limbs.get(obj);
  if (!l) return;
  // Stride length grows with speed, so feet do not slide visibly.
  const strideLen = 1.1 + speed * 0.12;
  l.phase = (l.phase + (speed / strideLen) * Math.PI * dt) % (Math.PI * 2);
  l.air += ((airborne ? 1 : 0) - l.air) * (1 - Math.exp(-dt * 12));
  const amp = Math.min(1, speed / 7) * 0.9 * (1 - l.air);
  const swing = Math.sin(l.phase) * amp;
  // Legs and arms swing in opposition (rotation.x > 0 moves the limb forward, toward -Z).
  l.legL.rotation.x = swing - l.air * 0.5;
  l.legR.rotation.x = -swing + l.air * 0.2;
  l.armL.rotation.x = -swing * 0.8 + l.air * 0.6;
  l.armR.rotation.x = swing * 0.8 + l.air * 0.6;
  l.armL.rotation.z = -0.08 - l.air * 0.3;
  l.armR.rotation.z = 0.08 + l.air * 0.3;
  // Lean into fast movement and bob with each step.
  l.torso.rotation.x = -Math.min(1, speed / 7) * 0.12;
  l.torso.position.y = -PLAYER_HALF_TOTAL + 0.9 + Math.abs(Math.cos(l.phase)) * amp * 0.05;
}

export function setPlayerViewVisible(obj: Object3D, visible: boolean): void {
  obj.visible = visible;
}
