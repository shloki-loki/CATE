/**
 * Minimal entity/component/system layer (T0016 §3.1).
 *
 * - Entities are numbers. Ids are recycled after destroy, with no generation
 *   counter, so do not keep entity ids across frames without checking isAlive().
 * - Components are typed stores keyed by a ComponentType token from defineComponent().
 * - Systems run in a fixed phase order; within a phase, in the order they were added.
 */

export type Entity = number;

export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Phantom field so ComponentType<A> and ComponentType<B> are distinct types. */
  readonly __type?: T;
}

let nextComponentId = 0;

export function defineComponent<T>(name: string): ComponentType<T> {
  return { id: nextComponentId++, name };
}

/** Simulation phases run once per fixed tick; frame phases once per rendered frame. */
export const SIM_PHASES = ['input', 'preSim', 'physics', 'postSim', 'ai', 'gameplay'] as const;
export const FRAME_PHASES = ['camera', 'render', 'ui'] as const;
export const PHASES = [...SIM_PHASES, ...FRAME_PHASES] as const;
export type SimPhase = (typeof SIM_PHASES)[number];
export type FramePhase = (typeof FRAME_PHASES)[number];
export type Phase = (typeof PHASES)[number];

/** A system. `S` is the services object (see src/services.ts); core stays independent of it. */
export interface System<S> {
  readonly name: string;
  readonly phase: Phase;
  init?(world: World<S>, services: S): void | Promise<void>;
  /** dt: fixed step for sim phases, real frame time (seconds) for frame phases. */
  update(world: World<S>, services: S, dt: number): void;
  dispose?(): void;
}

export class World<S> {
  private nextEntity = 1;
  private readonly free: Entity[] = [];
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<number, Map<Entity, unknown>>();
  private readonly systemsByPhase = new Map<Phase, System<S>[]>(PHASES.map((p) => [p, []]));
  private initialised = false;
  private services: S | null = null;

  createEntity(): Entity {
    const e = this.free.pop() ?? this.nextEntity++;
    this.alive.add(e);
    return e;
  }

  destroyEntity(e: Entity): void {
    if (!this.alive.delete(e)) return;
    for (const store of this.stores.values()) store.delete(e);
    this.free.push(e);
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  add<T>(e: Entity, type: ComponentType<T>, data: T): T {
    if (!this.alive.has(e)) throw new Error(`add(${type.name}): entity ${e} is not alive`);
    this.store(type).set(e, data);
    return data;
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type.id)?.get(e) as T | undefined;
  }

  /** Like get(), but throws if the component is missing. */
  require<T>(e: Entity, type: ComponentType<T>): T {
    const c = this.get(e, type);
    if (c === undefined) throw new Error(`entity ${e} has no ${type.name}`);
    return c;
  }

  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.stores.get(type.id)?.has(e) ?? false;
  }

  remove(e: Entity, type: ComponentType<unknown>): void {
    this.stores.get(type.id)?.delete(e);
  }

  /** Entities that have every listed component. Returns a fresh array, safe to mutate the world while iterating. */
  query(...types: ComponentType<unknown>[]): Entity[] {
    if (types.length === 0) return [...this.alive];
    const stores = types.map((t) => this.stores.get(t.id));
    if (stores.some((s) => s === undefined || s.size === 0)) return [];
    const sorted = (stores as Map<Entity, unknown>[]).sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sorted;
    const out: Entity[] = [];
    for (const e of smallest!.keys()) if (rest.every((s) => s.has(e))) out.push(e);
    return out;
  }

  addSystem(system: System<S>): void {
    this.systemsByPhase.get(system.phase)!.push(system);
    if (this.initialised && this.services && system.init) {
      const r = system.init(this, this.services);
      if (r instanceof Promise) throw new Error(`system ${system.name}: async init after World.init()`);
    }
  }

  systems(phase?: Phase): readonly System<S>[] {
    if (phase) return this.systemsByPhase.get(phase)!;
    return PHASES.flatMap((p) => this.systemsByPhase.get(p)!);
  }

  async init(services: S): Promise<void> {
    this.services = services;
    for (const s of this.systems()) await s.init?.(this, services);
    this.initialised = true;
  }

  /** Run all simulation phases once (one fixed tick). */
  runSim(services: S, dt: number): void {
    for (const p of SIM_PHASES) for (const s of this.systemsByPhase.get(p)!) s.update(this, services, dt);
  }

  /** Run all frame phases once (one rendered frame). */
  runFrame(services: S, dt: number): void {
    for (const p of FRAME_PHASES) for (const s of this.systemsByPhase.get(p)!) s.update(this, services, dt);
  }

  dispose(): void {
    for (const s of this.systems()) s.dispose?.();
    for (const list of this.systemsByPhase.values()) list.length = 0;
    this.stores.clear();
    this.alive.clear();
    this.free.length = 0;
  }

  private store<T>(type: ComponentType<T>): Map<Entity, unknown> {
    let s = this.stores.get(type.id);
    if (!s) this.stores.set(type.id, (s = new Map()));
    return s;
  }
}
