import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { defineComponent, type Entity } from '../core';
import type { BodyHandle } from '../physics';

/**
 * ALL shared component types live here (T0016 §4.4). Feature folders
 * (game/player, game/vehicles, ...) communicate only through these and game/events.ts.
 * Later tasks add fields/components here in their PRs.
 */

export interface TransformData {
  position: Vector3;
  quaternion: Quaternion;
}

export function makeTransform(x = 0, y = 0, z = 0): TransformData {
  return { position: new Vector3(x, y, z), quaternion: new Quaternion() };
}

/** Current simulation transform (written in postSim from physics, or by gameplay for non-physics entities). */
export const Transform = defineComponent<TransformData>('Transform');
/** Transform at the previous sim tick, for render interpolation. */
export const PrevTransform = defineComponent<TransformData>('PrevTransform');
export const RigidBody = defineComponent<{ handle: BodyHandle }>('RigidBody');
/** The scene object drawn for this entity. Created by a *View.ts factory. */
export const View = defineComponent<{ object3D: Object3D }>('View');
export const Health = defineComponent<{ hp: number; armor: number }>('Health');
export const PlayerTag = defineComponent<Record<string, never>>('PlayerTag');
export const Driver = defineComponent<{ mode: 'player' | 'ai' | 'none' }>('Driver');
export const Vehicle = defineComponent<{ defId: string; health: number; occupants: Entity[] }>('Vehicle');
export const Blip = defineComponent<{ icon: string; color: string }>('Blip');
/** Entity is removed together with its streamed chunk. */
export const Streamed = defineComponent<{ chunkId: string }>('Streamed');
