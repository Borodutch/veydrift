export type GameStateFreshness = "fresh" | "refreshing" | "delayed" | "failed";

export type GameStatePriority = "transaction" | "selected-planet" | "mission-control" | "background";

export type GameStateEntry<T = unknown> = {
  data?: T | undefined;
  error?: string | undefined;
  freshness: GameStateFreshness;
  generation: number;
  indexRevision?: string | undefined;
  lastSuccessfulUpdate?: number | undefined;
  wallet?: string | undefined;
  planetId?: string | undefined;
};

export type GameStateReadOptions = {
  dedupe?: boolean;
  deadlineMs?: number | undefined;
  planetId?: string | undefined;
  priority?: GameStatePriority | undefined;
  scope?: string | undefined;
  wallet?: string | undefined;
};

type ScheduledRead<T> = {
  controller: AbortController;
  deadlineAt: number;
  key: string;
  priority: number;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  settleTransport: () => void;
  released: boolean;
  started: boolean;
  timer: ReturnType<typeof setTimeout>;
};

type InFlightRead<T = unknown> = {
  controller: AbortController;
  generation: number;
  key: string;
  promise: Promise<T>;
  /** The request consumer may time out before an AbortSignal-aware transport
   * actually settles. Keep its canonical identity until then. */
  settled: Promise<void>;
  scope?: string | undefined;
};

const priorityOrder: Record<GameStatePriority, number> = {
  transaction: 0,
  "selected-planet": 1,
  "mission-control": 2,
  background: 3,
};

export class GameStateReadScheduler {
  private active = 0;
  private readonly queue: ScheduledRead<unknown>[] = [];
  private readonly tasks = new Map<AbortController, ScheduledRead<unknown>>();

  constructor(private readonly concurrency = 3) {}

  schedule<T>(key: string, run: (signal: AbortSignal) => Promise<T>, options: Pick<GameStateReadOptions, "deadlineMs" | "priority"> = {}): { controller: AbortController; promise: Promise<T>; settled: Promise<void> } {
    const controller = new AbortController();
    const deadlineMs = options.deadlineMs ?? 10_000;
    const deadlineAt = Date.now() + deadlineMs;
    let task!: ScheduledRead<T>;
    let settleTransport!: () => void;
    const settled = new Promise<void>((resolve) => {
      settleTransport = resolve;
    });
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const reason = gameStateDeadlineError(key, deadlineMs);
        controller.abort(reason);
        const index = this.queue.indexOf(task as ScheduledRead<unknown>);
        if (index >= 0) this.queue.splice(index, 1);
        this.tasks.delete(controller);
        // Do not free a concurrency slot until the underlying transport has
        // actually settled. AbortSignal is cooperative: freeing the slot here
        // used to let a slow-to-abort fetch overlap a replacement request and
        // exceed the scheduler's real network limit.
        reject(reason);
        if (!task.started) task.settleTransport();
      }, deadlineMs);
      task = {
        controller,
        deadlineAt,
        key,
        priority: priorityOrder[options.priority ?? "background"],
        run,
        resolve,
        reject,
        settleTransport,
        released: false,
        timer,
        started: false,
      };
      this.tasks.set(controller, task as ScheduledRead<unknown>);
      this.queue.push(task as ScheduledRead<unknown>);
      this.queue.sort((left, right) => left.priority - right.priority || left.deadlineAt - right.deadlineAt);
      this.drain();
    });
    return { controller, promise, settled };
  }

  cancel(controller: AbortController, reason = new DOMException("Request cancelled", "AbortError")): void {
    if (!controller.signal.aborted) controller.abort(reason);
    const task = this.tasks.get(controller);
    if (!task) return;
    this.tasks.delete(controller);
    const index = this.queue.findIndex((task) => task.controller === controller);
    if (index >= 0) this.queue.splice(index, 1);
    clearTimeout(task.timer);
    task.reject(reason);
    // See the deadline path above: a started read still owns its slot until
    // its promise settles, even after cancellation has rejected consumers.
    if (!task.started) task.settleTransport();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      if (task.controller.signal.aborted) continue;
      task.started = true;
      this.active += 1;
      Promise.resolve()
        .then(() => task.run(task.controller.signal))
        .then(task.resolve, task.reject)
        .finally(() => {
          clearTimeout(task.timer);
          this.tasks.delete(task.controller);
          if (!task.released) {
            task.released = true;
            this.active = Math.max(0, this.active - 1);
            this.drain();
          }
          task.settleTransport();
        });
    }
  }
}

export class GameStateStore {
  private readonly entries = new Map<string, GameStateEntry>();
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<string, InFlightRead>();
  private readonly activeReads = new Set<InFlightRead>();
  private readonly listeners = new Set<() => void>();
  private readonly listenersByKey = new Map<string, Set<() => void>>();

  constructor(private readonly scheduler = new GameStateReadScheduler(3)) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeKey(key: string, listener: () => void): () => void {
    const listeners = this.listenersByKey.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listenersByKey.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listenersByKey.delete(key);
    };
  }

  /**
   * A resource may be retained in the cache after a screen unmounts, but only
   * subscribed resources should be eagerly refreshed by the shared scheduler.
   */
  subscriberCount(key: string): number {
    return this.listenersByKey.get(key)?.size ?? 0;
  }

  subscribedKeys(): readonly string[] {
    return [...this.listenersByKey.keys()];
  }

  /** True while a transport for this canonical key is queued or running. */
  hasInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /** Resolves only when the underlying transport has settled, even if its
   * route consumer already received a deadline/cancellation error. */
  inFlightSettled(key: string): Promise<void> | undefined {
    return this.inFlight.get(key)?.settled;
  }

  snapshot<T>(key: string): GameStateEntry<T> | undefined {
    return this.entries.get(key) as GameStateEntry<T> | undefined;
  }

  value<T>(key: string): T | undefined {
    return this.snapshot<T>(key)?.data;
  }

  publish<T>(key: string, data: T, options: Omit<GameStateReadOptions, "dedupe" | "deadlineMs" | "priority" | "scope"> = {}): void {
    const generation = this.nextGeneration(key);
    this.entries.set(key, {
      data,
      freshness: "fresh",
      generation,
      indexRevision: backendIndexRevision(data),
      lastSuccessfulUpdate: Date.now(),
      planetId: options.planetId,
      wallet: normalizeWallet(options.wallet),
    });
    this.emit([key]);
  }

  fail(key: string, error: string | undefined): void {
    const current = this.entries.get(key);
    if (error === undefined) {
      if (!current) return;
      this.entries.set(key, {
        ...current,
        error: undefined,
        freshness: current.freshness === "refreshing" ? "refreshing" : current.data === undefined ? "delayed" : "fresh",
      });
      this.emit([key]);
      return;
    }
    const generation = this.nextGeneration(key);
    this.entries.set(key, {
      ...current,
      error,
      freshness: current?.data === undefined ? "failed" : "delayed",
      generation,
    });
    this.emit([key]);
  }

  clear(key: string): void {
    this.nextGeneration(key);
    this.entries.delete(key);
    this.emit([key]);
  }

  /** Remove every account-owned snapshot, including values produced by store
   * projections rather than a normal registered resource. Advancing each
   * generation prevents an old account transport from republishing later. */
  clearWallet(wallet: string): void {
    const normalized = normalizeWallet(wallet);
    if (!normalized) return;
    const cleared: string[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.wallet !== normalized) continue;
      this.nextGeneration(key);
      this.entries.delete(key);
      cleared.push(key);
    }
    if (cleared.length > 0) this.emit(cleared);
  }

  /** Drop an inactive canonical key completely so dynamic route/query keys do
   * not accumulate for the lifetime of a browser tab. */
  forget(key: string): boolean {
    if (this.inFlight.has(key) || this.subscriberCount(key) > 0) return false;
    this.entries.delete(key);
    this.generations.delete(key);
    this.emit([key]);
    return true;
  }

  /**
   * Retain last-good data but require the next consumer/invalidator to read a
   * new canonical backend snapshot. Advancing the generation also prevents an
   * older in-flight response from silently restoring the entry to `fresh`.
   */
  invalidate(key: string): void {
    const generation = this.nextGeneration(key);
    const current = this.entries.get(key);
    this.entries.set(key, {
      ...current,
      error: undefined,
      freshness: "delayed",
      generation,
    });
    this.emit([key]);
  }

  read<T>(key: string, load: (signal: AbortSignal) => Promise<T>, options: GameStateReadOptions = {}): Promise<T> {
    const running = this.inFlight.get(key) as InFlightRead<T> | undefined;
    if (running && options.dedupe !== false) return running.promise;

    const generation = this.nextGeneration(key);
    const previous = this.entries.get(key);
    this.entries.set(key, {
      ...previous,
      error: undefined,
      freshness: previous?.data === undefined ? "refreshing" : "refreshing",
      generation,
      planetId: options.planetId ?? previous?.planetId,
      wallet: normalizeWallet(options.wallet) ?? previous?.wallet,
    });
    this.emit([key]);

    const scheduled = this.scheduler.schedule(key, load, options);
    let promise!: Promise<T>;
    let request!: InFlightRead<T>;
    promise = scheduled.promise
      .then(
        (data) => {
          if (!this.isCurrent(key, generation)) return data;
          this.entries.set(key, {
            data,
            freshness: "fresh",
            generation,
            indexRevision: backendIndexRevision(data),
            lastSuccessfulUpdate: Date.now(),
            planetId: options.planetId,
            wallet: normalizeWallet(options.wallet),
          });
          this.emit([key]);
          return data;
        },
        (error) => {
          if (this.isCurrent(key, generation)) {
            const current = this.entries.get(key);
            const cancelled = isAbortError(error);
            this.entries.set(key, {
              ...current,
              error: cancelled ? undefined : errorMessage(error),
              freshness: cancelled ? (current?.data === undefined ? "delayed" : "fresh") : current?.data === undefined ? "failed" : "delayed",
              generation,
            });
            this.emit([key]);
          }
          throw error;
        },
      )
      .finally(() => {
        this.activeReads.delete(request as InFlightRead);
      });
    request = { controller: scheduled.controller, generation, key, promise, settled: scheduled.settled, scope: options.scope };
    this.inFlight.set(key, request);
    this.activeReads.add(request as InFlightRead);
    void scheduled.settled.finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });
    return promise;
  }

  cancelScope(scope: string): void {
    const cancelledKeys = new Set<string>();
    for (const request of [...this.activeReads]) {
      if (request.scope !== scope) continue;
      cancelledKeys.add(request.key);
      this.scheduler.cancel(request.controller, new DOMException(`Cancelled ${scope} request`, "AbortError"));
      this.activeReads.delete(request);
      // Keep the logical request until its underlying transport settles. A
      // cancellation only ends this consumer; abort is cooperative.
    }
    for (const key of cancelledKeys) {
      const generation = this.nextGeneration(key);
      const current = this.entries.get(key);
      this.entries.set(key, {
        ...current,
        error: undefined,
        freshness: current?.data === undefined ? "delayed" : "fresh",
        generation,
      });
    }
    if (cancelledKeys.size > 0) this.emit(cancelledKeys);
  }

  private nextGeneration(key: string): number {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }

  private isCurrent(key: string, generation: number): boolean {
    return this.generations.get(key) === generation;
  }

  private emit(keys: Iterable<string> = []): void {
    for (const listener of this.listeners) listener();
    for (const key of new Set(keys)) {
      for (const listener of this.listenersByKey.get(key) ?? []) listener();
    }
  }
}

export function backendIndexRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = record.indexRevision ?? record.indexedRevision ?? record.revision ?? record.indexedBlock ?? record.blockNumber ?? record.generatedAt;
  if (typeof direct === "string" || typeof direct === "number" || typeof direct === "bigint") return String(direct);
  const resourceSnapshot = record.resourceSnapshot;
  if (resourceSnapshot && typeof resourceSnapshot === "object") {
    const blockNumber = (resourceSnapshot as Record<string, unknown>).blockNumber;
    if (typeof blockNumber === "string" || typeof blockNumber === "number" || typeof blockNumber === "bigint") {
      return String(blockNumber);
    }
  }
  for (const nestedKey of ["fleetVisibility", "settlement", "planet"]) {
    const nestedRevision = backendIndexRevision(record[nestedKey]);
    if (nestedRevision !== undefined) return nestedRevision;
  }
  return undefined;
}

function gameStateDeadlineError(key: string, deadlineMs: number): Error {
  return new Error(`Timed out refreshing ${key} after ${Math.round(deadlineMs / 1_000)} seconds, including queue time.`);
}

function normalizeWallet(wallet: string | undefined): string | undefined {
  return wallet?.toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Game state refresh failed.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
