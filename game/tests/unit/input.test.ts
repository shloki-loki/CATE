import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyboardMouseInput } from '../../src/input';

/** Minimal DOM stand-ins so the real KeyboardMouseInput runs in Node. */
const g = globalThis as unknown as { window?: EventTarget; document?: unknown };

function key(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

describe('KeyboardMouseInput', () => {
  let input: KeyboardMouseInput;
  let win: EventTarget;
  beforeEach(() => {
    win = new EventTarget();
    g.window = win;
    g.document = { pointerLockElement: null };
    input = new KeyboardMouseInput(new EventTarget() as unknown as HTMLElement);
  });
  afterEach(() => {
    input.dispose();
    delete g.window;
    delete g.document;
  });

  it('reports a held key as down, and pressed only on the first poll', () => {
    win.dispatchEvent(key('keydown', 'Space'));
    input.poll();
    expect(input.pressed('jump')).toBe(true);
    expect(input.down('jump')).toBe(true);
    win.dispatchEvent(key('keydown', 'Space', true)); // auto-repeat
    input.poll();
    expect(input.pressed('jump')).toBe(false);
    expect(input.down('jump')).toBe(true);
    win.dispatchEvent(key('keyup', 'Space'));
    input.poll();
    expect(input.down('jump')).toBe(false);
  });

  it('does not lose a tap that starts and ends between two polls (slow frames)', () => {
    win.dispatchEvent(key('keydown', 'KeyF'));
    win.dispatchEvent(key('keyup', 'KeyF'));
    input.poll();
    expect(input.pressed('enterExit')).toBe(true);
    input.poll();
    expect(input.pressed('enterExit')).toBe(false);
  });

  it('maps WASD to camera-relative move axes', () => {
    win.dispatchEvent(key('keydown', 'KeyW'));
    win.dispatchEvent(key('keydown', 'KeyA'));
    input.poll();
    expect(input.axis('moveY')).toBe(1);
    expect(input.axis('moveX')).toBe(-1);
  });
});
