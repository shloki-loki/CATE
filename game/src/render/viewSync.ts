import type { Object3D, Quaternion, Vector3 } from 'three';

/**
 * Interpolate a view between the previous and current sim transforms (T0016 §4.6).
 * Gameplay owns Transform/PrevTransform; the render-phase ViewSync system calls this.
 */
export function syncView(
  obj: Object3D,
  prev: { position: Vector3; quaternion: Quaternion },
  curr: { position: Vector3; quaternion: Quaternion },
  alpha: number,
): void {
  obj.position.lerpVectors(prev.position, curr.position, alpha);
  obj.quaternion.slerpQuaternions(prev.quaternion, curr.quaternion, alpha);
}
