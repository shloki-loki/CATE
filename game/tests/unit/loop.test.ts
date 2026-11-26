import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../src/core';

function make(opts = {}) {
  const steps: number[] = [];
  const renders: number[] = [];
  const loop = new GameLoop({ step: (dt) => steps.push(dt), render: (a) => renders.push(a) }, opts);
  return { loop, steps, renders };
}

describe('GameLoop', () => {
  it('runs fixed 1/60 s steps and renders once per frame with alpha in [0,1)', () => {
    const { loop, steps, renders } = make();
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    expect(steps.length).toBeGreaterThanOrEqual(59);
    expect(steps.length).toBeLessThanOrEqual(60);
    expect(steps.every((d) => Math.abs(d - 1 / 60) < 1e-12)).toBe(true);
    expect(renders).toHaveLength(60);
    expect(renders.every((a) => a >= 0 && a < 1)).toBe(true);
  });

  it('is independent of frame rate: 1 s at 144 Hz and at 30 Hz gives ~60 ticks', () => {
    for (const hz of [144, 30]) {
      const { loop, steps } = make();
      for (let i = 0; i < hz; i++) loop.advance(1 / hz);
      expect(Math.abs(steps.length - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('caps sub-steps after a long stall and drops the excess', () => {
    const { loop, steps } = make({ maxSubSteps: 5 });
    const n = loop.advance(2); // 2 s hitch = 120 ticks owed
    expect(n).toBe(5);
    expect(steps).toHaveLength(5);
    expect(loop.droppedTime).toBeGreaterThan(1.8);
    loop.advance(1 / 60);
    expect(steps.length).toBeLessThanOrEqual(7);
  });

  it('ignores negative elapsed time', () => {
    const { loop, steps } = make();
    expect(loop.advance(-1)).toBe(0);
    expect(steps).toHaveLength(0);
  });
});
