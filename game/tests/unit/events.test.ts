import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core';

type E = { hit: { n: number }; other: string };

describe('EventBus', () => {
  it('queues until flush', () => {
    const bus = new EventBus<E>();
    const fn = vi.fn();
    bus.on('hit', fn);
    bus.emit('hit', { n: 1 });
    expect(fn).not.toHaveBeenCalled();
    bus.flush();
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('delivers events emitted during flush on the next flush (no re-entrancy)', () => {
    const bus = new EventBus<E>();
    const seen: string[] = [];
    bus.on('hit', () => {
      seen.push('hit');
      bus.emit('other', 'later');
    });
    bus.on('other', (s) => seen.push(s));
    bus.emit('hit', { n: 1 });
    bus.flush();
    expect(seen).toEqual(['hit']);
    bus.flush();
    expect(seen).toEqual(['hit', 'later']);
  });

  it('isolates a throwing handler and supports unsubscribe', () => {
    const errors: unknown[] = [];
    const bus = new EventBus<E>((_t, e) => errors.push(e));
    const good = vi.fn();
    bus.on('hit', () => {
      throw new Error('boom');
    });
    const off = bus.on('hit', good);
    bus.emit('hit', { n: 1 });
    bus.flush();
    expect(good).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    off();
    bus.emit('hit', { n: 2 });
    bus.flush();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
