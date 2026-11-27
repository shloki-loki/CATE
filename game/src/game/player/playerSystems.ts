import { Quaternion, Vector3 } from 'three';
import type { Entity } from '../../core';
import { CollisionGroup } from '../../physics';
import type { GameSystem, GameWorld, Services } from '../../services';
import {
  CameraRig,
  Character,
  Driver,
  Interactable,
  PlayerTag,
  PrevTransform,
  RigidBody,
  Transform,
  Vehicle,
  View,
  type CameraRigData,
  type CharacterData,
} from '../components';
import { approach, jumpVelocity, MOTOR, turnToward, wishDirection, yawOf } from './motor';
import { animatePlayerView, PLAYER_HALF_TOTAL, playerView, setPlayerViewVisible } from './playerView';

const RADIUS = 0.35;
const HALF_HEIGHT = PLAYER_HALF_TOTAL - RADIUS;

/** Camera presets owned by the player module (on foot / riding in a vehicle). */
export const ON_FOOT_RIG = { height: 0.65, distance: 4.2, minDistance: 1.8, maxDistance: 9 } as const;
export const IN_VEHICLE_RIG = { height: 1.3, distance: 7.5, minDistance: 4, maxDistance: 16 } as const;

function applyRig(rig: CameraRigData, p: typeof ON_FOOT_RIG | typeof IN_VEHICLE_RIG): void {
  rig.height = p.height;
  rig.minDistance = p.minDistance;
  rig.maxDistance = p.maxDistance;
  rig.distance = p.distance;
}

/**
 * Spawn the player: a kinematic capsule (1.8 m tall), the mannequin view, a follow-camera
 * rig looking along `yaw`, and the shared components other modules read.
 */
export function createPlayer(
  world: GameWorld,
  s: Services,
  at: { x: number; y: number; z: number },
  yaw = 0,
): Entity {
  const e = world.createEntity();
  const handle = s.physics.createCharacter({
    position: at,
    radius: RADIUS,
    halfHeight: HALF_HEIGHT,
  });
  s.physics.placeCharacter(handle, at, yaw);
  const t = { position: new Vector3(at.x, at.y, at.z), quaternion: new Quaternion() };
  s.physics.getTransform(handle, t);
  world.add(e, PlayerTag, {});
  world.add(e, Transform, t);
  world.add(e, PrevTransform, { position: t.position.clone(), quaternion: t.quaternion.clone() });
  world.add(e, RigidBody, { handle });
  world.add(e, Character, {
    handle,
    state: 'idle',
    velocity: new Vector3(),
    planar: { x: 0, z: 0 },
    grounded: false,
    facing: yaw,
    airTime: 0,
    jumpBuffer: 0,
    vehicle: null,
    focus: null,
    prompt: null,
    radius: RADIUS,
    halfHeight: HALF_HEIGHT,
    spawn: new Vector3(at.x, at.y, at.z),
  });
  const rig: CameraRigData = {
    yaw,
    pitch: 0.28,
    distance: 0,
    minDistance: 0,
    maxDistance: 0,
    height: 0,
    follow: null,
    autoRecenter: false,
    lookIdle: 0,
  };
  applyRig(rig, ON_FOOT_RIG);
  world.add(e, CameraRig, rig);
  const view = playerView();
  view.position.copy(t.position);
  view.quaternion.copy(t.quaternion);
  world.add(e, View, { object3D: view });
  s.render.addToWorld(view, 'dynamic');
  return e;
}

/** Teleport a character and reset interpolation, so it does not smear across the screen. */
function teleport(
  world: GameWorld,
  s: Services,
  e: Entity,
  c: CharacterData,
  pos: Vector3,
  yaw: number,
): void {
  s.physics.placeCharacter(c.handle, pos, yaw);
  c.facing = yaw;
  const t = world.get(e, Transform);
  const prev = world.get(e, PrevTransform);
  if (t) s.physics.getTransform(c.handle, t);
  if (t && prev) {
    prev.position.copy(t.position);
    prev.quaternion.copy(t.quaternion);
  }
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const fwd = new Vector3();

/** Heading (yaw) of a transform: where its local -Z points. */
function headingOf(q: Quaternion): number {
  fwd.set(0, 0, -1).applyQuaternion(q);
  return yawOf(fwd.x, fwd.z);
}

/** Find the nearest usable vehicle or Interactable in reach, preferring what the player faces. */
function findFocus(world: GameWorld, self: Entity, pos: Vector3, facing: number): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  const fx = -Math.sin(facing);
  const fz = -Math.cos(facing);
  const consider = (e: Entity, reach: number): void => {
    if (e === self) return;
    const t = world.get(e, Transform);
    if (!t) return;
    const dx = t.position.x - pos.x;
    const dz = t.position.z - pos.z;
    const dy = Math.abs(t.position.y - pos.y);
    const d = Math.hypot(dx, dz);
    if (d > reach || dy > 2.5) return;
    // Things in front score better than things behind (up to 1 m bonus).
    const facingDot = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
    const score = d - facingDot;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  };
  for (const e of world.query(Vehicle, Transform)) consider(e, MOTOR.vehicleReach);
  for (const e of world.query(Interactable, Transform)) consider(e, world.require(e, Interactable).radius);
  return best;
}

function enterVehicle(world: GameWorld, s: Services, e: Entity, c: CharacterData, vehicle: Entity): void {
  const v = world.require(vehicle, Vehicle);
  const stolen = world.get(vehicle, Driver)?.mode === 'ai';
  if (!v.occupants.includes(e)) v.occupants.push(e);
  world.add(vehicle, Driver, { mode: 'player' });
  c.state = 'inVehicle';
  c.vehicle = vehicle;
  c.velocity.set(0, 0, 0);
  c.planar.x = c.planar.z = 0;
  c.focus = null;
  c.prompt = null;
  s.physics.setBodyEnabled(c.handle, false);
  const view = world.get(e, View);
  if (view) setPlayerViewVisible(view.object3D, false);
  const rig = world.get(e, CameraRig);
  if (rig) {
    rig.follow = vehicle;
    rig.autoRecenter = true;
    applyRig(rig, IN_VEHICLE_RIG);
  }
  s.events.emit('vehicleEntered', { entity: e, vehicle, stolen });
}

/** Exit offsets in the vehicle's local frame: driver side (-X), passenger side, behind, front, roof. */
const EXIT_OFFSETS = [
  new Vector3(-1.9, 0, 0),
  new Vector3(1.9, 0, 0),
  new Vector3(0, 0, 3.4),
  new Vector3(0, 0, -3.4),
  new Vector3(0, 2.2, 0),
];

function exitVehicle(world: GameWorld, s: Services, e: Entity, c: CharacterData): void {
  const vehicle = c.vehicle;
  const vt = vehicle !== null && world.isAlive(vehicle) ? world.get(vehicle, Transform) : undefined;
  const me = world.require(e, Transform);
  const base = vt ? vt.position : me.position;
  const q = vt ? vt.quaternion : tmpQ.identity();
  const heading = vt ? headingOf(vt.quaternion) : c.facing;

  // First clear spot: sweep the capsule-sized sphere from the car's centre out to the spot.
  const from = tmpV.copy(base).setY(base.y + 0.6);
  let spot: Vector3 | null = null;
  for (const off of EXIT_OFFSETS) {
    const target = off.clone().applyQuaternion(q).add(base);
    target.y = Math.max(target.y, base.y) + 0.6;
    const dir = target.clone().sub(from);
    const dist = dir.length();
    const hit = s.physics.castSphere(from, dir, c.radius, dist, CollisionGroup.WORLD_STATIC);
    if (!hit) {
      spot = target;
      break;
    }
  }
  spot ??= base.clone().setY(base.y + 2.5);
  spot.y += c.halfHeight + c.radius - 0.6 + 0.05;

  s.physics.setBodyEnabled(c.handle, true);
  teleport(world, s, e, c, spot, heading);
  c.state = 'fall';
  c.grounded = false;
  c.vehicle = null;
  c.velocity.set(0, 0, 0);
  c.planar.x = c.planar.z = 0;
  const view = world.get(e, View);
  if (view) setPlayerViewVisible(view.object3D, true);
  const rig = world.get(e, CameraRig);
  if (rig) {
    rig.follow = null;
    rig.autoRecenter = false;
    applyRig(rig, ON_FOOT_RIG);
  }
  if (vehicle !== null && world.isAlive(vehicle)) {
    const v = world.get(vehicle, Vehicle);
    if (v) v.occupants = v.occupants.filter((o) => o !== e);
    world.add(vehicle, Driver, { mode: 'none' });
    s.events.emit('vehicleExited', { entity: e, vehicle });
  }
}

/** One fixed tick of on-foot movement for a character, from already-decided intent. */
export function stepCharacter(
  s: Services,
  c: CharacterData,
  intent: { wishX: number; wishZ: number; sprint: boolean; jump: boolean },
  dt: number,
): { landedSpeed: number | null } {
  const v = c.velocity;
  const wishLen = Math.hypot(intent.wishX, intent.wishZ);
  const speed = intent.sprint ? MOTOR.sprintSpeed : MOTOR.runSpeed;
  const tx = intent.wishX * speed;
  const tz = intent.wishZ * speed;
  const accel = c.grounded ? (wishLen > 0.01 ? MOTOR.groundAccel : MOTOR.groundDecel) : MOTOR.airAccel;
  const h = c.planar;
  approach(h, tx, tz, accel * dt);

  if (wishLen > 0.1) c.facing = turnToward(c.facing, yawOf(intent.wishX, intent.wishZ), MOTOR.turnRate, dt);

  // Jumping: buffered press + coyote time make it forgiving at ledges.
  c.jumpBuffer = intent.jump ? MOTOR.jumpBufferTime : Math.max(0, c.jumpBuffer - dt);
  let vy = v.y;
  if (c.jumpBuffer > 0 && (c.grounded || c.airTime < MOTOR.coyoteTime) && vy <= 0) {
    vy = jumpVelocity();
    c.jumpBuffer = 0;
    c.airTime = MOTOR.coyoteTime; // no second jump from coyote time
    c.grounded = false;
  } else if (c.grounded) {
    // No downward push while grounded: snap-to-ground keeps contact on slopes and steps,
    // and pushing into the floor makes Rapier's controller drop whole ticks of movement.
    vy = 0;
  } else {
    vy = Math.max(-MOTOR.maxFallSpeed, vy - MOTOR.gravity * dt);
  }

  const desiredY = vy * dt;
  const r = s.physics.moveCharacter(c.handle, { x: h.x * dt, y: desiredY, z: h.z * dt }, c.facing);

  // Report the velocity the world allowed (walls stop it, sliding redirects it).
  v.x = r.moved.x / dt;
  v.z = r.moved.z / dt;
  const wasGrounded = c.grounded;
  const fallSpeed = -vy;
  // Rising from a jump never counts as grounded (snap-to-ground must not cancel the jump).
  c.grounded = r.grounded && vy <= 0;
  if (c.grounded) {
    v.y = 0;
    c.airTime = 0;
  } else {
    // Bumped the head: stop rising.
    if (vy > 0 && r.moved.y < desiredY * 0.5) vy = 0;
    v.y = vy;
    c.airTime += dt;
  }

  const hs = Math.hypot(v.x, v.z);
  if (c.state !== 'aim' && c.state !== 'dead') {
    if (!c.grounded) c.state = v.y > 0 ? 'jump' : 'fall';
    else if (hs < MOTOR.idleSpeed) c.state = 'idle';
    else if (hs > (MOTOR.runSpeed + MOTOR.sprintSpeed) / 2) c.state = 'sprint';
    else if (hs > MOTOR.runSpeed * 0.6) c.state = 'run';
    else c.state = 'walk';
  }
  return { landedSpeed: !wasGrounded && c.grounded ? fallSpeed : null };
}

/**
 * Player systems: `player.control` (preSim; add it after the camera's control system so
 * it sees this tick's camera yaw) and `player.animate` (render).
 */
export function PlayerSystems(): GameSystem[] {
  const wish = { x: 0, z: 0 };

  const control: GameSystem = {
    name: 'player.control',
    phase: 'preSim',
    update(world, s, dt) {
      const i = s.input;
      for (const e of world.query(PlayerTag, Character, Transform)) {
        const c = world.require(e, Character);
        const t = world.require(e, Transform);

        if (c.state === 'inVehicle') {
          const vehicleGone = c.vehicle === null || !world.isAlive(c.vehicle);
          if (vehicleGone || i.pressed('enterExit')) {
            exitVehicle(world, s, e, c);
            continue;
          }
          // Ride along: keep the disabled capsule at the car so streaming/minimap see the player there.
          const vt = world.get(c.vehicle!, Transform);
          if (vt) s.physics.placeCharacter(c.handle, vt.position, headingOf(vt.quaternion));
          continue;
        }
        if (c.state === 'dead') continue;

        const rig = world.get(e, CameraRig);
        wishDirection(i.axis('moveX'), i.axis('moveY'), rig?.yaw ?? c.facing, wish);
        const { landedSpeed } = stepCharacter(
          s,
          c,
          { wishX: wish.x, wishZ: wish.z, sprint: i.down('sprint'), jump: i.pressed('jump') },
          dt,
        );
        if (landedSpeed !== null && landedSpeed > 4)
          s.events.emit('landed', { entity: e, speed: landedSpeed });

        // Interaction: nearest vehicle or Interactable in reach.
        c.focus = findFocus(world, e, t.position, c.facing);
        const focusIsVehicle = c.focus !== null && world.has(c.focus, Vehicle);
        c.prompt =
          c.focus === null
            ? null
            : focusIsVehicle
              ? 'F: enter vehicle'
              : `F: ${world.require(c.focus, Interactable).prompt}`;
        if (c.focus !== null && i.pressed('enterExit')) {
          if (focusIsVehicle) enterVehicle(world, s, e, c, c.focus);
          else
            s.events.emit('interact', {
              entity: e,
              target: c.focus,
              kind: world.require(c.focus, Interactable).kind,
            });
        }

        // Fell out of the world (through a gap or off the map): put it back at the spawn point.
        if (t.position.y < MOTOR.killY) {
          teleport(world, s, e, c, c.spawn, c.facing);
          c.velocity.set(0, 0, 0);
          c.planar.x = c.planar.z = 0;
        }
      }
    },
  };

  const animate: GameSystem = {
    name: 'player.animate',
    phase: 'render',
    update(world, _s, dt) {
      for (const e of world.query(Character, View)) {
        const c = world.require(e, Character);
        const speed = Math.hypot(c.velocity.x, c.velocity.z);
        animatePlayerView(world.require(e, View).object3D, speed, !c.grounded, dt);
      }
    },
  };

  return [control, animate];
}
