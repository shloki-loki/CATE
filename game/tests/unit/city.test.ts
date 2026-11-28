/**
 * T0027: procedural city. Layout rules, no overlapping geometry, T0018 naming, colliders,
 * load time, and glTF export. Driving and walking checks are in cityNavigation.test.ts.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BufferGeometry, Group, Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  ALLEY_WIDTH,
  BUILDING_STYLES,
  buildCityExportScene,
  buildCityMesh,
  CITY_NAMES,
  cityColliderDescs,
  cityMinimap,
  chunkId,
  exportCityGlb,
  generateCity,
  KERB_HEIGHT,
  rectInside,
  rectsOverlap,
  SIDEWALK_WIDTH,
  type CityData,
  type Rect,
} from '../../src/game/world';
import { RapierPhysics } from '../../src/physics';

const SEEDS = [1986, 1, 2, 3, 42, 777, 2024, 31337];

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

/** Sum of triangle areas in an index range, split into up-facing horizontal, other horizontal and the rest. */
function areas(g: BufferGeometry, start = 0, count = g.index!.count) {
  const p = g.attributes.position!.array;
  const idx = g.index!.array;
  const byHeight = new Map<number, number>();
  let vertical = 0;
  let sloped = 0;
  for (let k = start; k < start + count; k += 3) {
    const a = idx[k]! * 3;
    const b = idx[k + 1]! * 3;
    const c = idx[k + 2]! * 3;
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz) / 2;
    if (Math.abs(ny) / (2 * area) > 0.9999) {
      expect(ny, 'horizontal faces point up').toBeGreaterThan(0);
      const y = Math.round(p[a + 1]! * 1000) / 1000;
      byHeight.set(y, (byHeight.get(y) ?? 0) + area);
    } else if (Math.abs(ny) < 1e-9) vertical += area;
    else sloped += area;
  }
  return { byHeight, vertical, sloped };
}

const area = (r: Rect): number => r.w * r.d;

describe('city layout (generateCity)', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = JSON.stringify(generateCity({ seed: 5 }));
    expect(JSON.stringify(generateCity({ seed: 5 }))).toBe(a);
    expect(JSON.stringify(generateCity({ seed: 6 }))).not.toBe(a);
  });

  it('rejects bad options', () => {
    expect(() => generateCity({ gridSize: 4 })).toThrow();
    expect(() => generateCity({ spacing: 30 })).toThrow();
  });

  it('keeps the road network connected and every block on a drivable road, at any drop rate', () => {
    for (const seed of SEEDS)
      for (const dropChance of [0, 0.2, 0.6, 1]) {
        const c = generateCity({ seed, dropChance });
        expect(c.roads.isConnected(), `seed ${seed} drop ${dropChance}`).toBe(true);
        for (const n of c.roads.nodes) expect(c.roads.edgesOf(n.id).length).toBeGreaterThan(0);
        for (const s of c.surfaces.filter((s) => s.kind === 'block' || s.kind === 'park')) {
          const k = s.kerbs!;
          expect(k.n || k.s || k.w || k.e, `block at ${s.x},${s.z} touches a road`).toBe(true);
        }
      }
  });

  it('tiles the land exactly: surfaces never overlap and leave no gaps', () => {
    for (const seed of SEEDS) {
      const c = generateCity({ seed });
      const ss = c.surfaces;
      for (let i = 0; i < ss.length; i++) {
        expect(rectInside(ss[i]!, c.bounds), `surface ${i} inside the land`).toBe(true);
        for (let j = i + 1; j < ss.length; j++)
          if (rectsOverlap(ss[i]!, ss[j]!))
            throw new Error(`seed ${seed}: ${ss[i]!.kind} ${i} overlaps ${ss[j]!.kind} ${j}`);
      }
      const total = ss.reduce((t, s) => t + area(s), 0);
      expect(total / area(c.bounds)).toBeCloseTo(1, 9);
      // The sea surrounds the land without touching it.
      for (const r of c.sea) expect(rectsOverlap(r, c.bounds)).toBe(false);
    }
  });

  it('places buildings inside block lots: never on a road, sidewalk ring or another building', () => {
    for (const seed of SEEDS) {
      const c = generateCity({ seed });
      expect(c.buildings.length, `seed ${seed}`).toBeGreaterThan(150);
      const notBuildable = c.surfaces.filter((s) => s.kind !== 'block');
      for (const b of c.buildings) {
        const block = c.blocks.find((k) => rectInside(b, k));
        expect(block, `${b.id} lies in a block`).toBeDefined();
        expect(block!.park).toBe(false);
        const lots = { ...block!, w: block!.w - 2 * SIDEWALK_WIDTH, d: block!.d - 2 * SIDEWALK_WIDTH };
        expect(rectInside(b, lots), `${b.id} keeps the sidewalk clear`).toBe(true);
        for (const s of notBuildable) expect(rectsOverlap(b, s), `${b.id} vs ${s.kind}`).toBe(false);
        // Tiers stack: each sits on the one below and inside it.
        expect(b.tiers[0]!.y0).toBeCloseTo(KERB_HEIGHT, 9);
        expect(b.tiers[0]).toMatchObject({ x: b.x, z: b.z, w: b.w, d: b.d });
        for (let t = 1; t < b.tiers.length; t++) {
          expect(b.tiers[t]!.y0).toBeCloseTo(b.tiers[t - 1]!.y1, 9);
          expect(rectInside(b.tiers[t]!, b.tiers[t - 1]!)).toBe(true);
        }
        expect(b.height).toBeCloseTo(b.tiers[b.tiers.length - 1]!.y1, 9);
        expect(b.height).toBeGreaterThan(b.baseY + 2.9);
      }
      const bs = c.buildings;
      for (let i = 0; i < bs.length; i++)
        for (let j = i + 1; j < bs.length; j++)
          if (rectsOverlap(bs[i]!, bs[j]!, 0.75))
            throw new Error(`${bs[i]!.id} is within 1.5 m of ${bs[j]!.id}`);
    }
  });

  it('uses every district and the T0018 building styles', () => {
    const c = generateCity();
    const districts = new Set(c.buildings.map((b) => b.district));
    expect([...districts].sort()).toEqual(['beach', 'downtown', 'ind', 'res']);
    for (const b of c.buildings) expect(BUILDING_STYLES).toContain(b.style);
    expect(new Set(c.buildings.map((b) => b.style)).size).toBe(BUILDING_STYLES.length);
    expect(Math.max(...c.buildings.map((b) => b.height))).toBeGreaterThan(60); // a real downtown
  });
});

describe('naming (T0018 §8)', () => {
  it('building ids are b_<chunkX>_<chunkZ>_<index>, unique, numbered per chunk from 0', () => {
    for (const seed of SEEDS) {
      const c = generateCity({ seed });
      const ids = new Set<string>();
      const perChunk = new Map<string, number[]>();
      for (const b of c.buildings) {
        expect(b.id).toMatch(CITY_NAMES.building);
        expect(b.chunk).toMatch(CITY_NAMES.chunk);
        expect(b.chunk).toBe(chunkId(b.x, b.z));
        expect(b.id.startsWith(`b_${b.chunk.slice(2)}_`)).toBe(true);
        expect(ids.has(b.id)).toBe(false);
        ids.add(b.id);
        const list = perChunk.get(b.chunk) ?? [];
        list.push(Number(b.id.split('_').pop()));
        perChunk.set(b.chunk, list);
      }
      for (const list of perChunk.values()) expect(list).toEqual(list.map((_, k) => k));
    }
  });

  it('runtime meshes: chunk groups c_<x>_<z>, plain lowercase parts, fixed mat_ names', () => {
    const c = generateCity();
    const root = buildCityMesh(c);
    expect(root.name).toBe('city');
    const chunkNodes = root.children.filter((o) => o.type === 'Group');
    expect(chunkNodes.map((g) => g.name).sort()).toEqual([...c.chunks].sort());
    for (const g of chunkNodes) {
      expect(g.name).toMatch(CITY_NAMES.chunk);
      const names = g.children.map((m) => m.name);
      expect(new Set(names).size, `${g.name}: one mesh per material`).toBe(names.length);
    }
    for (const m of meshes(root)) {
      expect(m.name).toMatch(CITY_NAMES.part);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) expect(mat.name).toMatch(CITY_NAMES.material);
    }
  });

  it('facade meshes keep a building id -> index range table covering the whole mesh', () => {
    const c = generateCity();
    const seen = new Set<string>();
    for (const m of meshes(buildCityMesh(c))) {
      if (!m.name.startsWith('facade_')) continue;
      const list = m.userData.buildings as { id: string; start: number; count: number }[];
      let at = 0;
      for (const r of list) {
        expect(r.start).toBe(at);
        at += r.count;
        seen.add(r.id);
      }
      expect(at).toBe(m.geometry.index!.count);
    }
    expect(seen.size).toBe(c.buildings.length);
  });
});

describe('no overlapping geometry (meshes)', () => {
  const c = generateCity();
  const root = buildCityMesh(c);
  const byPart = new Map<string, Mesh[]>();
  for (const m of meshes(root)) byPart.set(m.name, [...(byPart.get(m.name) ?? []), m]);
  const sum = (parts: string[]) => {
    const h = new Map<number, number>();
    let vertical = 0;
    for (const p of parts)
      for (const m of byPart.get(p) ?? []) {
        const a = areas(m.geometry);
        for (const [y, v] of a.byHeight) h.set(y, (h.get(y) ?? 0) + v);
        vertical += a.vertical;
      }
    return { h, vertical };
  };

  it('ground faces cover each surface exactly once (markings are cut in, not laid on top)', () => {
    const { h } = sum(['road', 'sidewalk', 'grass', 'sand']);
    const atGround = c.surfaces.filter((s) => s.top === 0).reduce((t, s) => t + area(s), 0);
    const raised = c.surfaces.filter((s) => s.top > 0).reduce((t, s) => t + area(s), 0);
    expect([...h.keys()].sort()).toEqual([0, KERB_HEIGHT]);
    expect(h.get(0)! / atGround).toBeCloseTo(1, 6);
    expect(h.get(KERB_HEIGHT)! / raised).toBeCloseTo(1, 6);
    expect(atGround + raised).toBeCloseTo(area(c.bounds), 3);
  });

  it('kerb faces exist only where a raised piece meets asphalt', () => {
    const { vertical } = sum(['kerb']);
    let expected = 0;
    for (const s of c.surfaces) {
      const k = s.kerbs;
      if (!k) continue;
      expected += ((k.n ? s.w : 0) + (k.s ? s.w : 0) + (k.w ? s.d : 0) + (k.e ? s.d : 0)) * s.top;
    }
    expect(vertical).toBeGreaterThan(0);
    expect(vertical / expected).toBeCloseTo(1, 6);
  });

  it('every building wall and roof is drawn exactly once', () => {
    const exp = buildCityExportScene(c);
    const byId = new Map(c.buildings.map((b) => [b.id, b]));
    let checked = 0;
    for (const m of meshes(exp)) {
      const b = byId.get(m.name);
      if (!b) continue;
      const [facade, roof] = m.geometry.groups;
      const f = areas(m.geometry, facade!.start, facade!.count);
      const r = areas(m.geometry, roof!.start, roof!.count);
      const walls = b.tiers.reduce((t, x) => t + 2 * (x.w + x.d) * (x.y1 - x.y0), 0);
      const top = b.tiers[b.tiers.length - 1]!;
      const gable = b.roof === 'gable' ? Math.min(top.w, top.d) * b.roofHeight : 0;
      expect((f.vertical - gable) / walls, b.id).toBeCloseTo(1, 6);
      expect(f.byHeight.size, `${b.id}: no floors or bottoms drawn`).toBe(0);
      // Roof: every tier top minus the tier standing on it, once.
      let flat = 0;
      b.tiers.forEach((t, k) => {
        const next = b.tiers[k + 1];
        if (next) flat += area(t) - area(next);
        else if (b.roof === 'flat') flat += area(t);
      });
      const roofFlat = [...r.byHeight.values()].reduce((s, v) => s + v, 0);
      expect(roofFlat / Math.max(flat, 1e-9), b.id).toBeCloseTo(flat === 0 ? 0 : 1, 6);
      if (b.roof !== 'flat') expect(r.sloped).toBeGreaterThan(area(top) * 0.99);
      checked++;
    }
    expect(checked).toBe(c.buildings.length);
  });

  it('stays light: a few dozen draw calls and well under the triangle budget', () => {
    const ms = meshes(root);
    const tris = ms.reduce((t, m) => t + m.geometry.index!.count / 3, 0);
    expect(ms.length).toBeLessThan(80);
    expect(tris).toBeLessThan(300_000); // T0016 §5 allows 1.5 M visible
  });
});

describe('colliders', () => {
  it('one ground slab, a box per raised piece, a body per building (box per tier), four shore walls', () => {
    const c = generateCity();
    const d = cityColliderDescs(c);
    const raised = c.surfaces.filter((s) => s.top > 0).length;
    expect(d.length).toBe(1 + raised + c.buildings.length + 4);
    for (const b of c.buildings) {
      const body = d.find(
        (x) => x.position.x === b.x && x.position.z === b.z && x.shapes.length === b.tiers.length,
      );
      expect(body, b.id).toBeDefined();
    }
  });

  it('rays hit roofs, sidewalks and roads at the drawn heights (real Rapier)', async () => {
    const c = generateCity();
    const physics = new RapierPhysics();
    await physics.init();
    for (const desc of cityColliderDescs(c)) physics.createBody(desc);
    physics.step(1 / 60);
    const down = (x: number, z: number) => physics.raycast({ x, y: 300, z }, { x: 0, y: -1, z: 0 }, 400);
    for (const b of c.buildings.slice(0, 40)) {
      const top = b.tiers[b.tiers.length - 1]!;
      expect(300 - down(top.x, top.z)!.distance, b.id).toBeCloseTo(top.y1, 3);
    }
    const road = c.surfaces.find((s) => s.kind === 'road')!;
    expect(300 - down(road.x, road.z)!.distance).toBeCloseTo(0, 3);
    const walk = c.surfaces.find(
      (s) => s.kind === 'block' && !c.buildings.some((b) => rectsOverlap(b, { ...s, w: 1, d: 1 })),
    )!;
    expect(300 - down(walk.x - walk.w / 2 + 1, walk.z)!.distance).toBeCloseTo(KERB_HEIGHT, 3);
    physics.dispose();
  });
});

describe('load time', () => {
  it('generates, meshes and builds colliders for the default city well within 5 seconds', async () => {
    const physics = new RapierPhysics();
    await physics.init();
    const t0 = performance.now();
    const c = generateCity();
    const root: Group = buildCityMesh(c);
    for (const desc of cityColliderDescs(c)) physics.createBody(desc);
    const ms = performance.now() - t0;
    console.log(`city load (Node, seed ${c.seed}): ${ms.toFixed(0)} ms for ${c.buildings.length} buildings`);
    expect(root.children.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
    physics.dispose();
  });
});

describe('minimap and lap', () => {
  it('minimap shows every road, alley and building', () => {
    const c = generateCity();
    const m = cityMinimap(c);
    const alleys = c.surfaces.filter((s) => s.kind === 'alley');
    expect(m.roads.length).toBe(c.roads.edges.length + alleys.length);
    for (const r of m.roads.slice(c.roads.edges.length)) expect(r.width).toBe(ALLEY_WIDTH);
    expect(m.buildings.length).toBe(c.buildings.length);
    expect(m.bounds.maxX - m.bounds.minX).toBeCloseTo(c.bounds.w, 6);
  });

  it('the warm-up lap runs along kept roads and starts straight ahead of the player', () => {
    for (const seed of SEEDS) {
      const c: CityData = generateCity({ seed });
      expect(c.lap).toHaveLength(6);
      expect(c.lap[0]).toEqual(c.lap[5]);
      const node = (p: { x: number; z: number }) => c.roads.nearestNode(p.x, p.z);
      for (let k = 0; k + 1 < c.lap.length; k++) {
        // Walk node to node along a straight line; every step must be a kept road.
        let cur = node(c.lap[k]!);
        const end = node(c.lap[k + 1]!);
        expect(cur.x === end.x || cur.z === end.z).toBe(true);
        while (cur.id !== end.id) {
          const next = c.roads
            .neighbours(cur.id)
            .map((id) => c.roads.node(id))
            .find(
              (nb) =>
                (cur.x === end.x && nb.x === cur.x && Math.sign(nb.z - cur.z) === Math.sign(end.z - cur.z)) ||
                (cur.z === end.z && nb.z === cur.z && Math.sign(nb.x - cur.x) === Math.sign(end.x - cur.x)),
            );
          expect(next, `seed ${seed} leg ${k}`).toBeDefined();
          cur = next!;
        }
      }
      const p = c.spawnPoints.find((s) => s.kind === 'player')!;
      expect(p.yaw).toBeCloseTo(Math.PI, 9); // facing north (-Z)
      expect(Math.abs(p.x - c.lap[0]!.x)).toBeLessThan(3);
      expect(p.z - c.lap[0]!.z).toBeGreaterThan(20);
      // Every spawn point is on asphalt.
      for (const sp of c.spawnPoints) {
        const under = c.surfaces.find((s) => rectInside({ x: sp.x, z: sp.z, w: 0, d: 0 }, s));
        expect(['road', 'junction']).toContain(under?.kind);
      }
    }
  });
});

describe('glTF export (asset pipeline, T0018)', () => {
  it('exports a valid .glb whose nodes and materials follow the naming rules', async () => {
    const c = generateCity();
    const glb = await exportCityGlb(c);
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe('glTF');

    // Khronos glTF validator (the T0018 §5.5 step 5 check): no errors.
    const require = createRequire(import.meta.url);
    const validator = require('gltf-validator') as {
      validateBytes(
        data: Uint8Array,
        opts?: object,
      ): Promise<{
        issues: { numErrors: number; numWarnings: number; messages: { code: string; severity: number }[] };
      }>;
    };
    const report = await validator.validateBytes(new Uint8Array(glb), { maxIssues: 50 });
    const problems = report.issues.messages.filter((m) => m.severity <= 1).map((m) => m.code);
    expect(report.issues.numErrors, problems.join(', ')).toBe(0);
    expect(report.issues.numWarnings, problems.join(', ')).toBe(0);

    // Load it back with Three.js and check the names survived.
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const scene = gltf.scene;
    const root = scene.getObjectByName('city')!;
    expect(root).toBeDefined();
    expect(root.userData).toMatchObject({ seed: c.seed, buildings: c.buildings.length });
    const buildingNodes: Object3D[] = [];
    scene.traverse((o) => {
      if (CITY_NAMES.building.test(o.name)) buildingNodes.push(o);
    });
    expect(buildingNodes.map((o) => o.name).sort()).toEqual(c.buildings.map((b) => b.id).sort());
    for (const o of buildingNodes) {
      expect(o.parent!.name).toMatch(CITY_NAMES.chunk);
      expect(BUILDING_STYLES).toContain(o.userData.style);
    }
    const matNames = new Set<string>();
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) matNames.add(mat.name);
    });
    for (const n of matNames) expect(n).toMatch(CITY_NAMES.material);
    expect(matNames.has('mat_asphalt')).toBe(true);
    expect(matNames.has('mat_roof')).toBe(true);
  }, 30_000);

  it('the export tool script exists and is wired into package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['city:export']).toContain('tools/export-city.mjs');
  });
});
