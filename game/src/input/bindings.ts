import type { Button } from './InputAPI';

/** Default keyboard bindings, by KeyboardEvent.code. T0021 extends these; settings may override them later. */
export interface KeyBindings {
  forward: string[];
  back: string[];
  left: string[];
  right: string[];
  buttons: Record<Button, string[]>;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  buttons: {
    sprint: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space'],
    enterExit: ['KeyF'],
    fire: ['Mouse0'],
    aim: ['Mouse2'],
    handbrake: ['Space'],
    horn: ['KeyH'],
    map: ['KeyM'],
    pause: ['Escape', 'KeyP'],
    debug: ['F3'],
  },
};
