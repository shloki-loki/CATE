import {
  ACESFilmicToneMapping,
  Group,
  Mesh,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import type { Quality } from '../core';
import { Lighting } from './lighting';
import type { Layer, RenderAPI, RenderStats } from './RenderAPI';

const PRESETS: Record<Quality, { pixelRatioCap: number; shadows: boolean; shadowMap: number; far: number }> =
  {
    low: { pixelRatioCap: 1, shadows: false, shadowMap: 1024, far: 400 },
    medium: { pixelRatioCap: 1.5, shadows: true, shadowMap: 2048, far: 800 },
    high: { pixelRatioCap: 2, shadows: true, shadowMap: 4096, far: 1200 },
  };

/** Three.js WebGL2 implementation of RenderAPI. */
export class ThreeRenderer implements RenderAPI {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 800);
  private renderer: WebGLRenderer | null = null;
  private lighting: Lighting | null = null;
  private readonly layers: Record<Layer, Group> = {
    static: new Group(),
    dynamic: new Group(),
    debug: new Group(),
  };
  private quality: Quality = 'medium';
  private resizeObserver: ResizeObserver | null = null;
  private last: RenderStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const r = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.type = PCFShadowMap;
    this.renderer = r;

    for (const [name, g] of Object.entries(this.layers)) {
      g.name = `layer:${name}`;
      this.scene.add(g);
    }
    this.lighting = new Lighting(this.scene);
    this.applyQuality();

    this.resize();
    const parent = canvas.parentElement ?? document.body;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(parent);
  }

  addToWorld(obj: Object3D, layer: Layer): void {
    this.layers[layer].add(obj);
  }

  remove(obj: Object3D): void {
    obj.removeFromParent();
  }

  setTimeOfDay(hours: number): void {
    this.lighting?.setTimeOfDay(hours);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.applyQuality();
  }

  render(_alpha: number): void {
    const r = this.r();
    r.render(this.scene, this.camera);
    const i = r.info;
    this.last = {
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  }

  stats(): RenderStats {
    return this.last;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.renderer?.dispose();
    this.renderer = null;
  }

  private applyQuality(): void {
    const p = PRESETS[this.quality];
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatioCap));
      r.shadowMap.enabled = p.shadows;
    }
    this.lighting?.setShadowMapSize(p.shadowMap);
    this.camera.far = p.far;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const canvas = r.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    r.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private r(): WebGLRenderer {
    if (!this.renderer) throw new Error('ThreeRenderer: call init() first');
    return this.renderer;
  }
}
