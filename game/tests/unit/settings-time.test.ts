import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, Settings, TimeOfDay, type KeyValueStore } from '../../src/core';

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('Settings', () => {
  it('uses defaults, persists changes and notifies', () => {
    const store = memStore();
    const s = new Settings(store);
    expect(s.values).toEqual(DEFAULT_SETTINGS);
    let seen = '';
    s.onChange((v) => (seen = v.quality));
    s.set('quality', 'high');
    expect(seen).toBe('high');
    expect(new Settings(store).values.quality).toBe('high');
  });

  it('survives corrupt or invalid stored data', () => {
    expect(new Settings(memStore({ 'neon-coast.settings.v1': '{not json' })).values).toEqual(
      DEFAULT_SETTINGS,
    );
    const s = new Settings(memStore({ 'neon-coast.settings.v1': '{"quality":"ultra","masterVolume":7}' }));
    expect(s.values.quality).toBe('medium');
    expect(s.values.masterVolume).toBe(1);
  });

  it('works without any storage (Node)', () => {
    const s = new Settings(null);
    s.set('invertY', true);
    expect(s.values.invertY).toBe(true);
  });
});

describe('TimeOfDay', () => {
  it('advances 1 game hour per real minute by default and wraps at 24', () => {
    const t = new TimeOfDay(23.5);
    t.advance(60);
    expect(t.hours).toBeCloseTo(0.5, 6);
  });

  it('reports daylight and night', () => {
    expect(new TimeOfDay(12).daylight).toBeCloseTo(1, 6);
    expect(new TimeOfDay(0).daylight).toBe(0);
    expect(new TimeOfDay(2).isNight).toBe(true);
    expect(new TimeOfDay(12).isNight).toBe(false);
  });

  it('does not move when frozen', () => {
    const t = new TimeOfDay(8);
    t.frozen = true;
    t.advance(600);
    expect(t.hours).toBe(8);
  });
});
