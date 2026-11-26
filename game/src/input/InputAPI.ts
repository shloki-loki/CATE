/**
 * Input as actions (T0016 §3.6). Gameplay reads actions, never key codes,
 * so rebinding and gamepad support do not touch gameplay code.
 */
export const AXES = ['moveX', 'moveY', 'lookX', 'lookY', 'throttle', 'brake', 'steer', 'zoom'] as const;
export const BUTTONS = [
  'sprint',
  'jump',
  'enterExit',
  'fire',
  'aim',
  'handbrake',
  'horn',
  'map',
  'pause',
  'debug',
] as const;
export type Axis = (typeof AXES)[number];
export type Button = (typeof BUTTONS)[number];

export interface InputAPI {
  /** Called once per sim tick in the `input` phase, before anything reads actions. */
  poll(): void;
  /** Axis value. move/steer in [-1, 1], throttle/brake in [0, 1]; look/zoom are deltas since the last poll. */
  axis(a: Axis): number;
  /** True while held. */
  down(b: Button): boolean;
  /** True only on the tick the button went down. */
  pressed(b: Button): boolean;
  readonly pointerLocked: boolean;
  dispose(): void;
}

/** An input source that never reports anything (tests, headless). */
export class NullInput implements InputAPI {
  readonly pointerLocked = false;
  poll(): void {}
  axis(): number {
    return 0;
  }
  down(): boolean {
    return false;
  }
  pressed(): boolean {
    return false;
  }
  dispose(): void {}
}
