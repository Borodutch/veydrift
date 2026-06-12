import { keeperResolvableMissionTypes, missionTypeNames } from "./events";
import { MissionNotResolvableError, type MissionResolver } from "./resolver";

export type KeeperLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown) => void;
};

export const consoleLogger: KeeperLogger = {
  info: (message, meta) => console.log(message, meta ?? ""),
  warn: (message, meta) => console.warn(message, meta ?? ""),
  error: (message, error) => console.error(message, error ?? "")
};

export type PendingMission = {
  missionId: string;
  missionType: number;
  /** Unix seconds when the mission arrives and becomes resolvable. */
  arrivalAt: number;
};

export type KeeperSnapshot = {
  pendingCount: number;
  inFlightCount: number;
  resolvedCount: number;
  submitFailureCount: number;
  lastResolvedMissionId: string | null;
  lastResolvedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  keeperAddress: string;
  pendingMissionIds: string[];
};

export type BattleKeeperOptions = {
  maxConcurrency?: number;
  now?: () => number;
  logger?: KeeperLogger;
};

/**
 * Core, transport-agnostic battle-resolution engine. It owns the pending set and the resolve loop
 * and is driven by `recordLaunched`/`recordResolved` (from WS events or the safety sweep) plus
 * `tick()` (the resolution loop). All chain I/O is behind {@link MissionResolver} so this is unit
 * testable with a mock resolver.
 *
 * Invariants:
 *  - Only Attack/Harvest missions are tracked (everything else lazy-settles — out of scope).
 *  - A mission already resolved (observed event or successful submit) is never re-added.
 *  - A mission with an in-flight submission is never submitted again (idempotent / no double-submit).
 *  - A revert ("randomness not ready") leaves the mission pending for the next tick — never crashes.
 */
export class BattleKeeper {
  private readonly pending = new Map<string, PendingMission>();
  private readonly inFlight = new Set<string>();
  private readonly resolved = new Set<string>();
  private readonly maxConcurrency: number;
  private readonly now: () => number;
  private readonly logger: KeeperLogger;

  private resolvedCount = 0;
  private submitFailureCount = 0;
  private lastResolvedMissionId: string | null = null;
  private lastResolvedAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;

  constructor(
    private readonly resolver: MissionResolver,
    options: BattleKeeperOptions = {}
  ) {
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.logger = options.logger ?? consoleLogger;
  }

  /** Record a launched mission. No-op unless it is a keeper-resolvable combat leg (Attack/Harvest)
   * that we haven't already resolved or queued. */
  recordLaunched(mission: PendingMission): void {
    if (!keeperResolvableMissionTypes.has(mission.missionType)) {
      return;
    }
    if (this.resolved.has(mission.missionId) || this.pending.has(mission.missionId)) {
      return;
    }
    this.pending.set(mission.missionId, mission);
    this.logger.info("[keeper] queued mission", {
      missionId: mission.missionId,
      missionType: missionTypeNames[mission.missionType] ?? mission.missionType,
      arrivalAt: mission.arrivalAt
    });
  }

  /** Mark a mission resolved (from FleetMissionResolved / AttackBattleResolved). Drops it from the
   * pending set so the keeper stops trying to resolve it — works even if WE didn't resolve it. */
  recordResolved(missionId: string): void {
    const wasPending = this.pending.delete(missionId);
    this.inFlight.delete(missionId);
    if (!this.resolved.has(missionId)) {
      this.resolved.add(missionId);
      if (wasPending) {
        this.logger.info("[keeper] mission resolved (observed)", { missionId });
      }
    }
  }

  /** Missions that have arrived and are not currently being submitted. */
  private dueMissions(): PendingMission[] {
    const nowSeconds = this.now();
    const due: PendingMission[] = [];
    for (const mission of this.pending.values()) {
      if (mission.arrivalAt <= nowSeconds && !this.inFlight.has(mission.missionId)) {
        due.push(mission);
      }
    }
    return due;
  }

  /** One resolution pass: submit resolveFleetMission for every due mission, bounded concurrency. */
  async tick(): Promise<void> {
    const due = this.dueMissions();
    if (due.length === 0) {
      return;
    }

    // Simple bounded-concurrency worker pool over the due queue.
    const queue = [...due];
    const workerCount = Math.min(this.maxConcurrency, queue.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(this.drainQueue(queue));
    }
    await Promise.all(workers);
  }

  private async drainQueue(queue: PendingMission[]): Promise<void> {
    for (;;) {
      const mission = queue.shift();
      if (!mission) {
        return;
      }
      await this.submit(mission);
    }
  }

  private async submit(mission: PendingMission): Promise<void> {
    const { missionId } = mission;
    // Idempotency guard: skip if it raced into flight or got resolved between scan and submit.
    if (this.inFlight.has(missionId) || !this.pending.has(missionId)) {
      return;
    }
    this.inFlight.add(missionId);
    try {
      const hash = await this.resolver.resolveMission(missionId);
      // Successful on-chain resolution: treat as resolved immediately (the event is a backstop).
      this.pending.delete(missionId);
      this.resolved.add(missionId);
      this.resolvedCount += 1;
      this.lastResolvedMissionId = missionId;
      this.lastResolvedAt = new Date(this.now() * 1_000).toISOString();
      this.lastError = null;
      this.logger.info("[keeper] resolved mission", { missionId, hash });
    } catch (error) {
      this.submitFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastErrorAt = new Date(this.now() * 1_000).toISOString();
      if (error instanceof MissionNotResolvableError) {
        // Expected: randomness not committed yet / lost a race. Keep pending, retry next tick.
        this.logger.warn("[keeper] mission not resolvable yet, will retry", {
          missionId,
          reason: this.lastError
        });
      } else {
        this.logger.error("[keeper] resolve submission failed", error);
      }
    } finally {
      this.inFlight.delete(missionId);
    }
  }

  /** Reconcile the pending set against an authoritative reader (safety sweep backstop). Adds missions
   * the WS feed may have missed; existing/resolved ones are ignored by recordLaunched. */
  reconcilePending(resolvable: PendingMission[]): void {
    for (const mission of resolvable) {
      this.recordLaunched(mission);
    }
  }

  snapshot(): KeeperSnapshot {
    return {
      pendingCount: this.pending.size,
      inFlightCount: this.inFlight.size,
      resolvedCount: this.resolvedCount,
      submitFailureCount: this.submitFailureCount,
      lastResolvedMissionId: this.lastResolvedMissionId,
      lastResolvedAt: this.lastResolvedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      keeperAddress: this.resolver.keeperAddress(),
      pendingMissionIds: [...this.pending.keys()]
    };
  }
}
