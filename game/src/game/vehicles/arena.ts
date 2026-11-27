import { Quaternion, Vector3 } from 'three';
import { CollisionGroup, type PhysicsAPI } from '../../physics';
import type { VehicleControlData } from '../components';

/**
 * Vehicle test arena (T0025): a flat walled square with a ramp and kerbs, used by the
 * standalone arena page (arena.html) and the headless drive tests. Pure data plus a
 * physics builder; the meshes are built by arenaView.ts from the same layout.
 */
export interface ArenaBox {
  kind: 'ground' | 'wall' | 'ramp' | 'kerb';
  position: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  /** Rotation about +X (radians), used by the ramp. */
  pitch?: number;
}

export interface ArenaLayout {
  /** Half the inside width of the walled square (m). */
  half: number;
  boxes: ArenaBox[];
}

/** Where the scripted drive starts: south-east of centre, facing +Z (it turns right, towards -X). */
export const ARENA_START = { x: 30, y: 0, z: -70, yaw: 0 } as const;

/** The default arena: 240 m x 240 m inside walls; ramp and kerbs along the east wall, off the scripted drive's path. */
export function arenaLayout(half = 120): ArenaLayout {
  const wallH = 1.5;
  const t = 0.5;
  const boxes: ArenaBox[] = [
    {
      kind: 'ground',
      position: { x: 0, y: -0.5, z: 0 },
      halfExtents: { x: half + 20, y: 0.5, z: half + 20 },
    },
    {
      kind: 'wall',
      position: { x: 0, y: wallH / 2, z: half + t },
      halfExtents: { x: half + 2 * t, y: wallH / 2, z: t },
    },
    {
      kind: 'wall',
      position: { x: 0, y: wallH / 2, z: -half - t },
      halfExtents: { x: half + 2 * t, y: wallH / 2, z: t },
    },
    {
      kind: 'wall',
      position: { x: half + t, y: wallH / 2, z: 0 },
      halfExtents: { x: t, y: wallH / 2, z: half },
    },
    {
      kind: 'wall',
      position: { x: -half - t, y: wallH / 2, z: 0 },
      halfExtents: { x: t, y: wallH / 2, z: half },
    },
    // A gentle ramp (about 8 degrees) rising towards +Z, near the east wall.
    {
      kind: 'ramp',
      position: { x: half - 20, y: 0.2, z: -40 },
      halfExtents: { x: 3, y: 0.6, z: 7 },
      pitch: 0.14,
    },
  ];
  // A row of low kerbs to drive over, near the east wall.
  for (let i = 0; i < 4; i++) {
    boxes.push({
      kind: 'kerb',
      position: { x: half - 20, y: 0.04, z: 30 + i * 6 },
      halfExtents: { x: 4, y: 0.06, z: 0.25 },
    });
  }
  return { half, boxes };
}

/** Create the arena's static colliders. Returns the number of bodies created. */
export function createArenaPhysics(physics: PhysicsAPI, layout = arenaLayout()): number {
  const q = new Quaternion();
  const x = new Vector3(1, 0, 0);
  for (const b of layout.boxes) {
    q.setFromAxisAngle(x, b.pitch ?? 0);
    physics.createBody({
      type: 'static',
      position: b.position,
      rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      shapes: [{ kind: 'box', halfExtents: b.halfExtents }],
      group: CollisionGroup.WORLD_STATIC,
      friction: b.kind === 'wall' ? 0.4 : 0.9,
    });
  }
  return layout.boxes.length;
}

/** One phase of the scripted drive: hold `input` until `until` seconds. */
export interface DrivePhase {
  until: number;
  label: string;
  input: VehicleControlData;
}

const ctl = (throttle: number, brake: number, steer: number, handbrake = false): VehicleControlData => ({
  throttle,
  brake,
  steer,
  handbrake,
});

/**
 * A 30-second scripted test drive starting at ARENA_START facing +Z: accelerate,
 * turn right, brake, keep holding brake to reverse (as a player does), brake the reverse
 * with throttle and drive off, turn left, handbrake slide, handbrake to a stop.
 * (Holding brake at a standstill selects reverse, so the final stop uses the handbrake.)
 * Used by the arena page's `?autodrive` mode and the headless 30-second drive test.
 */
export const ARENA_DRIVE_SCRIPT: readonly DrivePhase[] = [
  { until: 1, label: 'idle', input: ctl(0, 0, 0) },
  { until: 4, label: 'accelerate', input: ctl(1, 0, 0) },
  { until: 8, label: 'turn right', input: ctl(0.4, 0, 1) },
  { until: 11, label: 'brake', input: ctl(0, 1, 0) },
  { until: 14, label: 'reverse', input: ctl(0, 1, 0) },
  { until: 15.5, label: 'stop and drive off', input: ctl(1, 0, 0) },
  { until: 21, label: 'turn left', input: ctl(0.4, 0, -1) },
  { until: 23, label: 'handbrake slide', input: ctl(0, 0, -1, true) },
  { until: 30, label: 'handbrake stop', input: ctl(0, 0, 0, true) },
];

export const ARENA_DRIVE_SECONDS = ARENA_DRIVE_SCRIPT[ARENA_DRIVE_SCRIPT.length - 1]!.until;

/** The scripted phase at `t` seconds (the last phase after the end). */
export function arenaDrivePhase(t: number): DrivePhase {
  for (const p of ARENA_DRIVE_SCRIPT) if (t < p.until) return p;
  return ARENA_DRIVE_SCRIPT[ARENA_DRIVE_SCRIPT.length - 1]!;
}
