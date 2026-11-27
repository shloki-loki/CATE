import type { Axis, Button, InputAPI } from './InputAPI';
import { BUTTONS } from './InputAPI';
import { DEFAULT_BINDINGS, type KeyBindings } from './bindings';

/**
 * Keyboard + mouse input. Mouse buttons are reported as codes "Mouse0".."Mouse2".
 * Mouse look works while a button is held (drag) or while pointer lock is active.
 */
export class KeyboardMouseInput implements InputAPI {
  private readonly held = new Set<string>();
  private readonly pressedNow = new Set<Button>();
  private readonly prevDown = new Set<Button>();
  private lookDX = 0;
  private lookDY = 0;
  private wheel = 0;
  private axes: Record<Axis, number> = {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    throttle: 0,
    brake: 0,
    steer: 0,
    zoom: 0,
  };

  constructor(
    private readonly target: HTMLElement,
    private readonly bindings: KeyBindings = DEFAULT_BINDINGS,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  poll(): void {
    const b = this.bindings;
    const any = (codes: string[]): boolean => codes.some((c) => this.held.has(c));
    const x = (any(b.right) ? 1 : 0) - (any(b.left) ? 1 : 0);
    const y = (any(b.forward) ? 1 : 0) - (any(b.back) ? 1 : 0);
    this.axes = {
      moveX: x,
      moveY: y,
      steer: x,
      throttle: y > 0 ? 1 : 0,
      brake: y < 0 ? 1 : 0,
      lookX: this.lookDX,
      lookY: this.lookDY,
      zoom: this.wheel,
    };
    this.lookDX = this.lookDY = this.wheel = 0;

    this.pressedNow.clear();
    for (const btn of BUTTONS) {
      const isDown = any(b.buttons[btn]);
      if (isDown && !this.prevDown.has(btn)) this.pressedNow.add(btn);
      if (isDown) this.prevDown.add(btn);
      else this.prevDown.delete(btn);
    }
  }

  axis(a: Axis): number {
    return this.axes[a];
  }

  down(b: Button): boolean {
    return this.prevDown.has(b);
  }

  pressed(b: Button): boolean {
    return this.pressedNow.has(b);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    this.held.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.held.clear(); // avoid stuck keys after alt-tab
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    this.held.add(`Mouse${e.button}`);
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    this.held.delete(`Mouse${e.button}`);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    const dragging = this.held.has('Mouse0') || this.held.has('Mouse2');
    if (!dragging && !this.pointerLocked) return;
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };
  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
}
