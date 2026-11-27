import { describe, expect, it } from 'vitest';
import { defineComponent, World, type System } from '../../src/core';

const Pos = defineComponent<{ x: number }>('Pos');
const Vel = defineComponent<{ v: number }>('Vel');

describe('World', () => {
  it('creates, queries and destroys entities', () => {
    const w = new World<null>();
    const a = w.createEntity();
    const b = w.createEntity();
    w.add(a, Pos, { x: 1 });
    w.add(a, Vel, { v: 2 });
    w.add(b, Pos, { x: 3 });
    expect(w.query(Pos).sort()).toEqual([a, b].sort());
    expect(w.query(Pos, Vel)).toEqual([a]);
    expect(w.get(a, Vel)?.v).toBe(2);
    w.destroyEntity(a);
    expect(w.isAlive(a)).toBe(false);
    expect(w.query(Pos, Vel)).toEqual([]);
    expect(w.get(a, Pos)).toBeUndefined();
    expect(w.entityCount).toBe(1);
  });

  it('recycles ids and does not leak components into the new entity', () => {
    const w = new World<null>();
    const a = w.createEntity();
    w.add(a, Pos, { x: 1 });
    w.destroyEntity(a);
    const c = w.createEntity();
    expect(c).toBe(a);
    expect(w.has(c, Pos)).toBe(false);
  });

  it('refuses components on dead entities and require() throws when missing', () => {
    const w = new World<null>();
    const a = w.createEntity();
    w.destroyEntity(a);
    expect(() => w.add(a, Pos, { x: 0 })).toThrow(/not alive/);
    const b = w.createEntity();
    expect(() => w.require(b, Pos)).toThrow(/no Pos/);
  });

  it('runs sim phases in order on runSim and frame phases on runFrame', async () => {
    const w = new World<string[]>();
    const log: string[] = [];
    const sys = (name: string, phase: System<string[]>['phase']): System<string[]> => ({
      name,
      phase,
      update: (_w, s) => s.push(name),
    });
    // Added out of order on purpose.
    w.addSystem(sys('render', 'render'));
    w.addSystem(sys('gameplay', 'gameplay'));
    w.addSystem(sys('input', 'input'));
    w.addSystem(sys('physics', 'physics'));
    w.addSystem(sys('camera', 'camera'));
    w.addSystem(sys('physics2', 'physics'));
    await w.init(log);
    w.runSim(log, 1 / 60);
    expect(log).toEqual(['input', 'physics', 'physics2', 'gameplay']);
    log.length = 0;
    w.runFrame(log, 1 / 60);
    expect(log).toEqual(['camera', 'render']);
  });
});
