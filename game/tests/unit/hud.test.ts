import { describe, expect, it } from 'vitest';
import {
  createDemoScene,
  CheckpointRun,
  CheckpointRunSystem,
  spawnVehicle,
  WARMUP_LAP,
} from '../../src/game';
import type { CheckpointRunDef } from '../../src/game';
import { createHudReader } from '../../src/hudBridge';
import {
  clampToDisc,
  formatDistance,
  formatTime,
  mapImageScale,
  mapRotation,
  worldToMinimap,
  zoomRadius,
  type MinimapView,
} from '../../src/ui';
import { createHarness, pos } from './vehicleHarness';

const view = (heading: number, cx = 0, cz = 0): MinimapView => ({ cx, cz, heading, radius: 100, size: 200 });
const close = (a: number, b: number): void => expect(a).toBeCloseTo(b, 6);

describe('minimap projection (T0023)', () => {
  it('puts the player at the centre and their forward direction at the top, whatever the heading', () => {
    for (const h of [0, 0.4, Math.PI / 2, Math.PI, -2.2, 3]) {
      const v = view(h, 37, -12);
      const c = worldToMinimap(v, 37, -12);
      close(c.sx, 0);
      close(c.sy, 0);
      // 50 m straight ahead along forward = (sin h, cos h) -> 50 px straight up (size 200, radius 100).
      const a = worldToMinimap(v, 37 + Math.sin(h) * 50, -12 + Math.cos(h) * 50);
      close(a.sx, 0);
      close(a.sy, -50);
      // 50 m to the driver's right -> 50 px to the right. Right of forward (fx, fz) is (-fz, fx)
      // in this world (+X east, -Z north), e.g. facing north (-Z) the right is east (+X).
      const r = worldToMinimap(v, 37 - Math.cos(h) * 50, -12 + Math.sin(h) * 50);
      close(r.sx, 50);
      close(r.sy, 0);
    }
  });

  it('is north-up when facing -Z and not mirrored', () => {
    expect(mapRotation(Math.PI)).toBe(0);
    const v = view(Math.PI);
    const east = worldToMinimap(v, 10, 0);
    expect(east.sx).toBeGreaterThan(0);
    close(east.sy, 0);
    const north = worldToMinimap(v, 0, -10);
    expect(north.sy).toBeLessThan(0);
  });

  it('keeps distant blips on the rim in the right direction', () => {
    const c = clampToDisc(300, -400, 90);
    expect(c.clamped).toBe(true);
    close(Math.hypot(c.sx, c.sy), 90);
    close(c.sx / c.sy, 300 / -400);
    expect(clampToDisc(10, 20, 90)).toEqual({ sx: 10, sy: 20, clamped: false });
  });

  it('zooms out smoothly with speed, within limits', () => {
    expect(zoomRadius(0)).toBe(75);
    expect(zoomRadius(-40)).toBe(zoomRadius(40));
    expect(zoomRadius(80)).toBeGreaterThan(zoomRadius(40));
    expect(zoomRadius(500)).toBe(160);
  });

  it('caps the cached map image at 4096 px', () => {
    const small = { bounds: { minX: -200, minZ: -200, maxX: 200, maxZ: 200 } };
    const big = { bounds: { minX: -5000, minZ: -3000, maxX: 5000, maxZ: 3000 } };
    expect(mapImageScale({ ...small, outside: 'water', areas: [], roads: [], buildings: [] })).toBe(2);
    const s = mapImageScale({ ...big, outside: 'land', areas: [], roads: [], buildings: [] });
    expect(10000 * s).toBeLessThanOrEqual(4096);
  });
});

describe('HUD text formatting', () => {
  it('formats distances and times', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(143.4)).toBe('143 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1250)).toBe('1.25 km');
    expect(formatDistance(NaN)).toBe('');
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(5.36)).toBe('0:05.3');
    expect(formatTime(65.3)).toBe('1:05.3');
    expect(formatTime(600)).toBe('10:00.0');
    expect(formatTime(-3)).toBe('0:00.0');
  });
});

describe('checkpoint run (mission indicator source)', () => {
  const def: CheckpointRunDef = {
    id: 't',
    title: 'T',
    checkpoints: [
      { x: 0, z: -20 },
      { x: 0, z: -40 },
    ],
    radius: 5,
    restartDelay: 1,
  };

  it('waits for the player to move, then times the run through every checkpoint in order', () => {
    const run = new CheckpointRun(def);
    expect(run.update(0.1, null)).toEqual([]);
    expect(run.update(0.1, { x: 0, z: 0 })).toEqual([{ kind: 'started' }]);
    run.update(1, { x: 0, z: 0 });
    expect(run.elapsed).toBe(0); // clock waits for the player to move
    expect(run.objective).toMatch(/start the lap/);
    run.update(1, { x: 0, z: -5 });
    expect(run.phase).toBe('running');
    expect(run.elapsed).toBe(1);
    // The second checkpoint does not count before the first.
    expect(run.update(1, { x: 0, z: -40 })).toEqual([]);
    expect(run.update(1, { x: 1, z: -18 })).toEqual([{ kind: 'step', step: 1, steps: 2 }]);
    expect(run.target).toEqual({ x: 0, z: -40 });
    expect(run.objective).toBe('Reach the finish');
    const r = run.update(1, { x: 0, z: -41 });
    expect(r).toEqual([
      { kind: 'step', step: 2, steps: 2 },
      { kind: 'passed', time: 4, best: true },
    ]);
    expect(run.target).toBeNull();
    expect(run.banner).toBe('LAP COMPLETE  0:04.0  NEW BEST');
    // After the delay it starts over from the first checkpoint.
    run.update(0.5, { x: 0, z: -41 });
    expect(run.phase).toBe('passed');
    expect(run.update(0.6, { x: 0, z: -41 })).toEqual([{ kind: 'started' }]);
    expect(run.index).toBe(0);
    expect(run.banner).toBeNull();
    expect(run.elapsed).toBe(0);
    expect(run.best).toBe(4);
  });

  it('bumps the revision whenever the objective changes', () => {
    const run = new CheckpointRun(def);
    run.update(0.1, { x: 0, z: 0 });
    const r0 = run.revision;
    run.update(0.1, { x: 0, z: -20 });
    expect(run.revision).toBeGreaterThan(r0);
  });

  it('the warm-up lap checkpoints all lie on demo-scene roads', async () => {
    const h = await createHarness();
    const scene = createDemoScene(h.world, h.s);
    for (const cp of WARMUP_LAP.checkpoints) {
      const onRoad = scene.map.roads.some((r) => {
        const alongX = r.az === r.bz;
        const [lo, hi] = alongX
          ? [Math.min(r.ax, r.bx), Math.max(r.ax, r.bx)]
          : [Math.min(r.az, r.bz), Math.max(r.az, r.bz)];
        const along = alongX ? cp.x : cp.z;
        const across = alongX ? Math.abs(cp.z - r.az) : Math.abs(cp.x - r.ax);
        return along >= lo && along <= hi && across <= r.width / 2;
      });
      expect(onRoad, `checkpoint ${cp.x},${cp.z}`).toBe(true);
    }
    h.dispose();
  });
});

describe('demo scene minimap layout', () => {
  it('lists every building and the road grid, inside the bounds', async () => {
    const h = await createHarness();
    const scene = createDemoScene(h.world, h.s);
    const m = scene.map;
    expect(m.buildings.length).toBe(scene.buildings);
    expect(m.roads.length).toBe(6);
    for (const b of m.buildings) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(m.bounds.minX);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(m.bounds.maxX);
      expect(b.z - b.d / 2).toBeGreaterThanOrEqual(m.bounds.minZ);
      expect(b.z + b.d / 2).toBeLessThanOrEqual(m.bounds.maxZ);
      // No building is drawn on a road.
      for (const r of m.roads) {
        const alongX = r.az === r.bz;
        const gap = alongX ? Math.abs(b.z - r.az) - b.d / 2 : Math.abs(b.x - r.ax) - b.w / 2;
        expect(gap).toBeGreaterThan(r.width / 2 - 1e-6);
      }
    }
    h.dispose();
  });
});

describe('HUD reader (headless: vehicle + mission -> HudModel)', () => {
  it('reports the player car speed and position and the live objective', async () => {
    const h = await createHarness();
    const def: CheckpointRunDef = {
      id: 'straight',
      title: 'STRAIGHT',
      checkpoints: [
        { x: 0, z: -25 },
        { x: 0, z: -60 },
      ],
      radius: 6,
      restartDelay: 3,
    };
    h.world.addSystem(CheckpointRunSystem(def));
    const steps: unknown[] = [];
    h.s.events.on('missionStep', (p) => steps.push(p));
    const car = spawnVehicle(h.world, h.s, 'sports', 0, 0, 0, { driver: 'player', yaw: Math.PI });
    const read = createHudReader(h.world);

    h.run(1);
    let m = read();
    expect(m.vehicle).not.toBeNull();
    expect(Math.abs(m.vehicle!.speedKmh)).toBeLessThan(1);
    expect(m.player!.heading).toBeCloseTo(Math.PI, 2);
    expect(m.mission!.title).toBe('STRAIGHT');
    expect(m.mission!.target).toEqual({ x: 0, z: -25 });
    expect(m.blips).toEqual([{ x: 0, z: -25, kind: 'objective' }]);

    h.input.set(1, 0, 0);
    // Drive until past the first checkpoint but short of the second.
    for (let i = 0; i < 100 && pos(h, car).z > -35; i++) h.run(0.1);
    m = read();
    const p = pos(h, car);
    expect(m.vehicle!.speedKmh).toBeGreaterThan(30);
    expect(m.player!.speedKmh).toBeGreaterThan(30);
    expect(m.player!.x).toBe(p.x);
    expect(m.player!.z).toBe(p.z);
    expect(p.z).toBeLessThan(-25);
    expect(steps[0]).toEqual({ id: 'straight', step: 1, steps: 2 });
    expect(m.mission!.target).toEqual({ x: 0, z: -60 });
    expect(m.mission!.elapsed).toBeGreaterThan(0);
    h.dispose();
  });
});
