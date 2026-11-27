/**
 * Typed, queued event bus (T0016 §3.1).
 * emit() only queues; flush() delivers. Events emitted by a handler during flush()
 * are delivered on the next flush(), so nothing fires re-entrantly mid-physics.
 */
export type EventMap = Record<string, unknown>;
export type Handler<P> = (payload: P) => void;

export class EventBus<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();
  private queue: { type: keyof E; payload: unknown }[] = [];
  private onError: (type: keyof E, err: unknown) => void;

  constructor(onError?: (type: keyof E, err: unknown) => void) {
    this.onError =
      onError ??
      ((type, err) => {
        console.error(`[events] handler for "${String(type)}" threw`, err);
      });
  }

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.queue.push({ type, payload });
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Deliver everything queued so far. One handler throwing does not stop the others. */
  flush(): void {
    const batch = this.queue;
    this.queue = [];
    for (const { type, payload } of batch) {
      const set = this.handlers.get(type);
      if (!set) continue;
      for (const fn of [...set]) {
        try {
          (fn as Handler<unknown>)(payload);
        } catch (err) {
          this.onError(type, err);
        }
      }
    }
  }

  clear(): void {
    this.queue = [];
    this.handlers.clear();
  }
}
