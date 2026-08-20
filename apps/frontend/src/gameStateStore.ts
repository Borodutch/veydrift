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
  released: boolean;
  started: boolean;
  timer: ReturnType<typeof setTimeout>;
};

type InFlightRead<T = unknown> = {
  controller: AbortController;
  generation: number;
  key: string;
  promise: Promise<T>;
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

  schedule<T>(
    key: string,
    run: (signal: AbortSignal) => Promise<T>,
    options: Pick<GameStateReadOptions, "deadlineMs" | "priority"> = {},
  ): { controller: AbortController; promise: Promise<T> } {
    const controller = new AbortController();
    const deadlineMs = options.deadlineMs ?? 10_000;
    const deadlineAt = Date.now() + deadlineMs;
    let task!: ScheduledRead<T>;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const reason = gameStateDeadlineError(key, deadlineMs);
        controller.abort(reason);
        const index = this.queue.indexOf(task as ScheduledRead<unknown>);
        if (index >= 0) this.queue.splice(index, 1);
        this.tasks.delete(controller);
        if (task.started && !task.released) {
          task.released = true;
          this.active = Math.max(0, this.active - 1);
          this.drain();
        }
        reject(reason);
      }, deadlineMs);
      task = {
        controller,
        deadlineAt,
        key,
        priority: priorityOrder[options.priority ?? "background"],
        run,
        resolve,
        reject,
        released: false,
        timer,
        started: false,
      };
      this.tasks.set(controller, task as ScheduledRead<unknown>);
      this.queue.push(task as ScheduledRead<unknown>);
      this.queue.sort((left, right) => left.priority - right.priority || left.deadlineAt - right.deadlineAt);
      this.drain();
    });
    return { controller, promise };
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
    if (task.started && !task.released) {
      task.released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    }
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

  constructor(private readonly scheduler = new GameStateReadScheduler(3)) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    this.emit();
  }

  fail(key: string, error: string | undefined): void {
    const generation = this.nextGeneration(key);
    const current = this.entries.get(key);
    this.entries.set(key, {
      ...current,
      error,
      freshness: error
        ? (current?.data === undefined ? "failed" : "delayed")
        : (current?.data === undefined ? "delayed" : "fresh"),
      generation,
    });
    this.emit();
  }

  clear(key: string): void {
    this.nextGeneration(key);
    this.entries.delete(key);
    this.emit();
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
    this.emit();

    const scheduled = this.scheduler.schedule(key, load, options);
    let promise!: Promise<T>;
    let request!: InFlightRead<T>;
    promise = scheduled.promise.then((data) => {
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
      this.emit();
      return data;
    }, (error) => {
      if (this.isCurrent(key, generation)) {
        const current = this.entries.get(key);
        const cancelled = isAbortError(error);
        this.entries.set(key, {
          ...current,
          error: cancelled ? undefined : errorMessage(error),
          freshness: cancelled
            ? (current?.data === undefined ? "delayed" : "fresh")
            : (current?.data === undefined ? "failed" : "delayed"),
          generation,
        });
        this.emit();
      }
      throw error;
    }).finally(() => {
      if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
      this.activeReads.delete(request as InFlightRead);
    });
    request = { controller: scheduled.controller, generation, key, promise, scope: options.scope };
    this.inFlight.set(key, request);
    this.activeReads.add(request as InFlightRead);
    return promise;
  }

  cancelScope(scope: string): void {
    const cancelledKeys = new Set<string>();
    for (const request of [...this.activeReads]) {
      if (request.scope !== scope) continue;
      cancelledKeys.add(request.key);
      this.scheduler.cancel(request.controller, new DOMException(`Cancelled ${scope} request`, "AbortError"));
      this.activeReads.delete(request);
      if (this.inFlight.get(request.key) === request) this.inFlight.delete(request.key);
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
    if (cancelledKeys.size > 0) this.emit();
  }

  private nextGeneration(key: string): number {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }

  private isCurrent(key: string, generation: number): boolean {
    return this.generations.get(key) === generation;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function backendIndexRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = record.indexRevision
    ?? record.indexedRevision
    ?? record.revision
    ?? record.indexedBlock
    ?? record.blockNumber
    ?? record.generatedAt;
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
