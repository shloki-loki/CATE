/**
 * A checkpoint run: drive through a list of checkpoints in order against the clock.
 * Pure logic (no Three.js, no physics), so it is unit-tested in Node. It is the
 * placeholder objective that drives the HUD mission indicator (T0023) until the
 * mission system task adds data-driven story missions.
 */
export interface CheckpointRunDef {
  id: string;
  title: string;
  checkpoints: readonly { x: number; z: number }[];
  /** Metres from a checkpoint's centre (on the ground plane) that count as reaching it. */
  radius: number;
  /** Seconds the result banner stays up before the run starts again. */
  restartDelay: number;
}

export type RunEvent =
  | { kind: 'started' }
  | { kind: 'step'; step: number; steps: number }
  | { kind: 'passed'; time: number; best: boolean };

/**
 * The clock waits until the player's car has moved this far from where the player took
 * the wheel (or where the run began, if they were already driving).
 */
const START_MOVE = 2;

export class CheckpointRun {
  /** Index of the checkpoint to reach next. */
  index = 0;
  /** Seconds since the clock started (0 while waiting for the player to move). */
  elapsed = 0;
  best: number | null = null;
  phase: 'waiting' | 'running' | 'passed' = 'waiting';
  /** Bumped whenever the objective changes. */
  revision = 0;
  banner: string | null = null;
  /** True while the player is driving (the last update had a position). */
  driving = false;
  private anchor: { x: number; z: number } | null = null;
  /** Whether this run's 'started' event has been sent. */
  private announced = false;
  private bannerLeft = 0;

  constructor(readonly def: CheckpointRunDef) {
    if (def.checkpoints.length === 0) throw new Error(`CheckpointRun ${def.id}: no checkpoints`);
  }

  get steps(): number {
    return this.def.checkpoints.length;
  }

  get target(): { x: number; z: number } | null {
    return this.phase === 'passed' ? null : this.def.checkpoints[this.index]!;
  }

  get objective(): string {
    if (this.phase === 'passed') return 'Next lap starts soon';
    if (this.index === this.steps - 1) return 'Reach the finish';
    if (this.index === 0 && this.phase === 'waiting')
      return this.driving
        ? 'Drive to the yellow checkpoint to start the lap'
        : 'Get in a car (F) to start the lap';
    return 'Drive through the yellow checkpoint';
  }

  /**
   * Advance by `dt` seconds. `pos` is the position of the car the player is driving, or
   * null when they are not driving (on foot, or no player). It is a driving lap: only the
   * car's position counts, and before the clock starts the anchor is retaken wherever the
   * player takes the wheel, so walking to a car, getting in and idling never starts the
   * clock. Once running, the clock keeps going if the player gets out.
   */
  update(dt: number, pos: { x: number; z: number } | null): RunEvent[] {
    const out: RunEvent[] = [];
    if (this.driving !== (pos !== null)) {
      this.driving = pos !== null;
      if (this.phase === 'waiting') this.revision++; // the objective text changes
    }
    if (this.phase === 'passed') {
      this.bannerLeft -= dt;
      if (this.bannerLeft <= 0) this.restart(pos, out);
      return out;
    }
    if (!pos) {
      if (this.phase === 'waiting') this.anchor = null;
      else this.elapsed += dt;
      return out;
    }
    if (this.anchor === null) this.anchor = { x: pos.x, z: pos.z };
    if (!this.announced) {
      this.announced = true;
      out.push({ kind: 'started' });
    }
    if (this.phase === 'waiting' && Math.hypot(pos.x - this.anchor.x, pos.z - this.anchor.z) > START_MOVE) {
      this.phase = 'running';
      this.revision++;
    }
    if (this.phase === 'running') this.elapsed += dt;
    const cp = this.def.checkpoints[this.index]!;
    if (Math.hypot(pos.x - cp.x, pos.z - cp.z) > this.def.radius) return out;

    if (this.phase === 'waiting') this.phase = 'running'; // started right on the checkpoint
    this.index++;
    this.revision++;
    out.push({ kind: 'step', step: this.index, steps: this.steps });
    if (this.index < this.steps) return out;

    const best = this.best === null || this.elapsed < this.best;
    if (best) this.best = this.elapsed;
    this.phase = 'passed';
    this.bannerLeft = this.def.restartDelay;
    this.banner = `LAP COMPLETE  ${formatLap(this.elapsed)}${best ? '  NEW BEST' : ''}`;
    out.push({ kind: 'passed', time: this.elapsed, best });
    return out;
  }

  private restart(pos: { x: number; z: number } | null, out: RunEvent[]): void {
    this.index = 0;
    this.elapsed = 0;
    this.phase = 'waiting';
    this.banner = null;
    this.anchor = pos ? { x: pos.x, z: pos.z } : null;
    this.revision++;
    this.announced = this.anchor !== null;
    if (this.announced) out.push({ kind: 'started' });
  }
}

/** m:ss.t */
export function formatLap(seconds: number): string {
  const tenths = Math.floor(Math.max(0, seconds) * 10);
  const m = Math.floor(tenths / 600);
  return `${m}:${((tenths - m * 600) / 10).toFixed(1).padStart(4, '0')}`;
}

/**
 * The demo scene's warm-up lap (~550 m from the spawn): the central crossing, a loop
 * round the west and north roads and down the east side, finishing back at the central
 * crossing. Checkpoints sit on road crossings and the route avoids the parked cars.
 */
export const WARMUP_LAP: CheckpointRunDef = {
  id: 'warmupLap',
  title: 'WARM-UP LAP',
  checkpoints: [
    { x: 0, z: 0 },
    { x: -84, z: 0 },
    { x: -84, z: -84 },
    { x: 84, z: -84 },
    { x: 84, z: 0 },
    { x: 0, z: 0 },
  ],
  radius: 9,
  restartDelay: 5,
};
