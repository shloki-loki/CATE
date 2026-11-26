/**
 * Fixed-timestep game loop (T0016 §3.1): simulation at a fixed rate (default 60 Hz),
 * at most `maxSubSteps` steps per frame (avoids the spiral of death), and one render
 * per animation frame with interpolation alpha in [0, 1).
 *
 * advance() is pure and deterministic so it can be unit-tested without a browser.
 */
export interface LoopCallbacks {
  /** One simulation tick of `dt` seconds. */
  step(dt: number): void;
  /** One render. alpha = fraction of the next tick already elapsed; frameDt = real seconds since last frame. */
  render(alpha: number, frameDt: number): void;
}

export interface LoopOptions {
  stepHz?: number;
  maxSubSteps?: number;
}

export class GameLoop {
  readonly dt: number;
  readonly maxSubSteps: number;
  private accumulator = 0;
  private lastTime: number | null = null;
  private rafId: number | null = null;
  private running = false;
  private paused = false;
  /** Total simulation ticks run. */
  ticks = 0;
  /** Total frames rendered. */
  frames = 0;
  /** Time dropped because a frame needed more than maxSubSteps ticks. */
  droppedTime = 0;

  constructor(
    private readonly cb: LoopCallbacks,
    opts: LoopOptions = {},
  ) {
    this.dt = 1 / (opts.stepHz ?? 60);
    this.maxSubSteps = opts.maxSubSteps ?? 5;
  }

  /** Advance by `elapsed` real seconds: run 0..maxSubSteps ticks, then render once. Returns ticks run. */
  advance(elapsed: number): number {
    const frameDt = Math.max(0, elapsed);
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSubSteps) {
      this.cb.step(this.dt);
      this.accumulator -= this.dt;
      steps++;
      this.ticks++;
    }
    if (this.accumulator >= this.dt) {
      // Too far behind: drop the excess instead of trying to catch up forever.
      const keep = this.accumulator % this.dt;
      this.droppedTime += this.accumulator - keep;
      this.accumulator = keep;
    }
    this.cb.render(this.accumulator / this.dt, frameDt);
    this.frames++;
    return steps;
  }

  /** Start the requestAnimationFrame loop (browser only). Pauses while the tab is hidden. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = null;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.lastTime = null; // do not count paused time as elapsed
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private readonly onFrame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.onFrame);
    const elapsed = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.paused) {
      this.cb.render(this.accumulator / this.dt, 0);
      this.frames++;
      return;
    }
    this.advance(elapsed);
  };

  private readonly onVisibility = (): void => {
    // Reset timing when the tab comes back so the hidden time is not simulated.
    this.lastTime = null;
  };
}
