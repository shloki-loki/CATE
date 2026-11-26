import type { Object3D, PerspectiveCamera } from 'three';
import type { Quality } from '../core';

/** Rendering contract (T0016 §4.3). Engine-specific code stays inside src/render/. */
export type Layer = 'static' | 'dynamic' | 'debug';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface RenderAPI {
  init(canvas: HTMLCanvasElement): Promise<void>;
  addToWorld(obj: Object3D, layer: Layer): void;
  remove(obj: Object3D): void;
  readonly camera: PerspectiveCamera;
  setTimeOfDay(hours: number): void;
  setQuality(q: Quality): void;
  /** Draw one frame. alpha is the sim interpolation factor (views are synced before this). */
  render(alpha: number): void;
  stats(): RenderStats;
  dispose(): void;
}
