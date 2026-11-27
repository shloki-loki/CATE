import type { Object3D } from 'three';
import { Mesh, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../../src/assets';
import { NullAudio } from '../../src/audio';
import { createClock, EventBus, Settings, TimeOfDay } from '../../src/core';
import { edgeRect, generateCity, loadCity, rectsOverlap, type GameEvents } from '../../src/game';
import { NullInput } from '../../src/input';
import { RapierPhysics } from '../../src/physics';
import type { RenderAPI } from '../../src/render';
import type { Services } from '../../src/services';

const SEEDS = [1, 2, 3, 42, 1986, 7777, 31337, 99999];

describe('generateCity', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = generateCity({ seed: 5 });
    expect(generateCity({ seed: 5 })).toEqual(a);
    expect(generateCity({ seed: 6 }).buildings).not.toEqual(a.buildings);
  });

  it('always produces one connected road network', () => {
    for (const seed of SEEDS) {
      for (const dropChance of [0, 0.18, 0.6, 0.95]) {
        const { roads } = generateCity({ seed, dropChance });
        expect(roads.componentCount(), `seed ${seed} drop ${dropChance}`).toBe(1);
        for (const n of roads.nodes) expect(roads.edgesOf(n.id).length).toBeGreaterThan(0);
      }
    }
  });

  it('places many buildings, none overlapping each other or a road', () => {
    for (const seed of SEEDS) {
      const city = generateCity({ seed });
      expect(city.buildings.length).toBeGreaterThan(80);
      const roadRects = city.roads.edges.map((e) => edgeRect(city, e.id));
      for (const [i, b] of city.buildings.entries()) {
        expect(b.h).toBeGreaterThan(3);
        for (const r of roadRects) expect(rectsOverlap(b, r)).toBe(false);
        for (let j = i + 1; j < city.buildings.length; j++)
          expect(rectsOverlap(b, city.buildings[j]!)).toBe(false);
      }
    }
  });

  it('rejects invalid options', () => {
    expect(() => generateCity({ gridSize: 2 })).toThrow();
    expect(() => generateCity({ spacing: 10 })).toThrow();
  });

  it('generates a default city quickly', () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) generateCity({ seed: i });
    expect((performance.now() - t) / 20).toBeLessThan(50);
  });
});

class RecordingRender implements RenderAPI {
  readonly camera = new PerspectiveCamera();
  readonly added: Object3D[] = [];
  async init(): Promise<void> {}
  addToWorld(o: Object3D): void {
    this.added.push(o);
  }
  remove(): void {}
  setTimeOfDay(): void {}
  setQuality(): void {}
  render(): void {}
  stats() {
    return { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
  }
  dispose(): void {}
}

describe('loadCity (headless engine integration)', () => {
  it('loads meshes and colliders; few draw calls; a ray hits a building and the ground', async () => {
    const physics = new RapierPhysics();
    await physics.init();
    const render = new RecordingRender();
    const s: Services = {
      physics,
      render,
      audio: new NullAudio(),
      input: new NullInput(),
      assets: new AssetRegistry('./', { version: 1, assets: {} }),
      events: new EventBus<GameEvents>(),
      settings: new Settings(null),
      time: new TimeOfDay(),
      clock: createClock(),
    };
    const t = performance.now();
    const { city, bodies } = loadCity(s, { seed: 1986 });
    const ms = performance.now() - t;
    expect(bodies).toBe(1 + city.buildings.length);
    expect(physics.bodyCount).toBe(bodies);
    expect(ms).toBeLessThan(2000);

    let meshes = 0;
    let triangles = 0;
    render.added[0]!.traverse((o) => {
      if (o instanceof Mesh) {
        meshes++;
        const g = o.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position!.count) / 3;
      }
    });
    expect(meshes).toBeLessThan(20); // merged: draw calls do not grow with city size
    expect(triangles).toBeLessThan(250_000);

    physics.step(1 / 60); // refresh the query structures
    const b = city.buildings[0]!;
    const hit = physics.raycast({ x: b.x, y: b.h + 20, z: b.z }, { x: 0, y: -1, z: 0 }, 500);
    expect(hit?.point.y).toBeCloseTo(b.h, 1);
    const n = city.roads.nodes[0]!;
    const ground = physics.raycast({ x: n.x, y: 10, z: n.z }, { x: 0, y: -1, z: 0 }, 50);
    expect(ground?.point.y).toBeCloseTo(0, 1);
    physics.dispose();
  });
});
