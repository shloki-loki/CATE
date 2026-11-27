/**
 * Game clock (T0016 §3.1). By default 1 real minute = 1 game hour.
 * Drives lighting, traffic density and street lights in later tasks.
 */
export class TimeOfDay {
  /** Game hours in [0, 24). */
  hours: number;
  /** Game hours per real second. 1/60 means 1 real minute = 1 game hour. */
  rate: number;
  frozen = false;

  constructor(startHours = 10, rate = 1 / 60) {
    this.hours = TimeOfDay.wrap(startHours);
    this.rate = rate;
  }

  advance(realSeconds: number): void {
    if (this.frozen) return;
    this.hours = TimeOfDay.wrap(this.hours + realSeconds * this.rate);
  }

  /** 0 at midnight, 1 at noon: a smooth daylight factor for lighting. */
  get daylight(): number {
    return Math.max(0, Math.sin(((this.hours - 6) / 24) * Math.PI * 2));
  }

  get isNight(): boolean {
    return this.hours < 6 || this.hours >= 20;
  }

  static wrap(h: number): number {
    return ((h % 24) + 24) % 24;
  }
}

/** Frame/tick bookkeeping shared with systems through Services. */
export interface Clock {
  /** Interpolation factor for the current render frame, [0, 1). */
  alpha: number;
  /** Simulation ticks run since boot. */
  tick: number;
  /** Frames rendered since boot. */
  frame: number;
  /** Simulated seconds since boot. */
  simTime: number;
}

export function createClock(): Clock {
  return { alpha: 0, tick: 0, frame: 0, simTime: 0 };
}
