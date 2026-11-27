/**
 * Audio contract (T0016 §3.7). The procedural-audio follow-up task implements it
 * with the Web Audio API. Until then the game uses NullAudio (silent).
 */
export type SoundHandle = number & { readonly __brand: 'Sound' };
export type Bus = 'sfx' | 'ambience' | 'music' | 'ui';

export interface PlayOptions {
  position?: { x: number; y: number; z: number };
  volume?: number;
  loop?: boolean;
  bus?: Bus;
}

export interface AudioAPI {
  play(soundId: string, opts?: PlayOptions): SoundHandle;
  setParam(h: SoundHandle, name: string, value: number): void;
  stop(h: SoundHandle): void;
  setMasterVolume(v: number): void;
  dispose(): void;
}

export class NullAudio implements AudioAPI {
  private next = 1;
  play(): SoundHandle {
    return this.next++ as SoundHandle;
  }
  setParam(): void {}
  stop(): void {}
  setMasterVolume(): void {}
  dispose(): void {}
}
