import { keeperResolvableMissionTypes, missionTypeNames } from "./events";
import { MissionNotResolvableError, type MissionLeg, type MissionResolver } from "./resolver";

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

/** What the keeper needs to record a freshly launched mission (from a WS event or the sweep). */
export type LaunchedMission = {
  missionId: string;
  missionType: number;
  /** Unix seconds when the mission arrives. */
  arrivalAt: number;
  /** Unix seconds the return leg becomes resolvable; 0 means the mission has no return leg. */
  returnAt: number;
};

/** A mission tracked in the pending set, currently awaiting one specific leg. */
export type PendingMission = {
  missionId: string;
  missionType: number;
  /** Which leg we are waiting to resolve next. */
  leg: MissionLeg;
  /** Unix seconds when {@link leg} becomes resolvable (arrivalAt for "arrival", returnAt for "return"). */
  dueAt: number;
  /** Known return time (from the launch event, refined by FleetMissionResolved). 0 => no return leg. */
  returnAt: number;
};

export type KeeperSnapshot = {
  pendingCount: number;
  awaitingArrivalCount: number;
  awaitingReturnCount: number;
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
 * Core, transport-agnostic fleet-mission resolution engine. It owns the pending set and the resolve
 * loop and is driven by `recordLaunched`/`recordArrivalResolved`/`recordReturned` (from WS events or
 * the safety sweep) plus `tick()` (the resolution loop). All chain I/O is behind {@link MissionResolver}
 * so this is unit testable with a mock resolver.
 *
 * Each mission is a small two-leg state machine:
 *   awaiting-arrival --(resolveFleetMission)--> { awaiting-return | terminal }
 *   awaiting-return  --(completeFleetMissionReturn)--> terminal
 * The keeper resolves whichever leg is due so nothing waits on a player's mutating call.
 *
 * Invariants:
 *  - Every outbound mission type is tracked for its arrival; round-trip types also get a return leg.
 *  - A terminal mission (FleetMissionReturned, or arrival-resolved with no return) is never re-added.
 *  - A mission with an in-flight submission is never submitted again (idempotent / no double-submit).
 *  - A revert (arrival: randomness not ready; return: not due / wrong status) leaves the mission
 *    pending for the next tick — never crashes.
 */
export class BattleKeeper {
  private readonly pending = new Map<string, PendingMission>();
  private readonly inFlight = new Set<string>();
  /** Missions that are fully done (return resolved, or arrival resolved with no return leg). */
  private readonly terminal = new Set<string>();
  private readonly maxConcurrency: number;
  private readonly now: () => number;
  private readonly logger: KeeperLogger;
  /** Re-entrancy guard so overlapping timers (resolve loop + sweep) never run tick() concurrently —
   * concurrent ticks would submit different missions in parallel and collide on the keeper EOA nonce. */
  private ticking = false;

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

  /** Record a launched mission into the awaiting-arrival leg. No-op for a non-resolvable type, or a
   * mission we have already settled or are already tracking (any leg). */
  recordLaunched(mission: LaunchedMission): void {
    if (!keeperResolvableMissionTypes.has(mission.missionType)) {
      return;
    }
    if (this.terminal.has(mission.missionId) || this.pending.has(mission.missionId)) {
      return;
    }
    this.pending.set(mission.missionId, {
      missionId: mission.missionId,
      missionType: mission.missionType,
      leg: "arrival",
      dueAt: mission.arrivalAt,
      returnAt: mission.returnAt
    });
    this.logger.info("[keeper] queued mission (arrival)", {
      missionId: mission.missionId,
      missionType: missionTypeNames[mission.missionType] ?? mission.missionType,
      arrivalAt: mission.arrivalAt,
      returnAt: mission.returnAt
    });
  }

  /** The arrival leg is done (observed FleetMissionResolved, or our own successful resolve). If the
   * mission has a return leg (returnAt > 0) transition it to awaiting-return with the authoritative
   * returnAt; otherwise it is terminal. Idempotent and safe even if we never saw the launch. */
  recordArrivalResolved(event: { missionId: string; missionType: number; returnAt: number }): void {
    const { missionId, missionType, returnAt } = event;
    this.inFlight.delete(missionId);
    if (this.terminal.has(missionId)) {
      return;
    }
    if (returnAt > 0) {
      const existing = this.pending.get(missionId);
      const wasArrival = !existing || existing.leg === "arrival";
      this.pending.set(missionId, {
        missionId,
        missionType: existing?.missionType ?? missionType,
        leg: "return",
        dueAt: returnAt,
        returnAt
      });
      if (wasArrival) {
        this.logger.info("[keeper] arrival resolved, awaiting return", { missionId, returnAt });
      }
    } else {
      const wasTracked = this.pending.delete(missionId);
      this.terminal.add(missionId);
      if (wasTracked) {
        this.logger.info("[keeper] arrival resolved (terminal, no return)", { missionId });
      }
    }
  }

  /** The return leg is done (FleetMissionReturned). Drop the mission — it is terminal. */
  recordReturned(missionId: string): void {
    const wasTracked = this.pending.delete(missionId);
    this.inFlight.delete(missionId);
    if (!this.terminal.has(missionId)) {
      this.terminal.add(missionId);
      if (wasTracked) {
        this.logger.info("[keeper] return resolved (terminal)", { missionId });
      }
    }
  }

  /** Missions whose current leg is due and that are not currently being submitted. */
  private dueMissions(): PendingMission[] {
    const nowSeconds = this.now();
    const due: PendingMission[] = [];
    for (const mission of this.pending.values()) {
      if (mission.dueAt <= nowSeconds && !this.inFlight.has(mission.missionId)) {
        due.push(mission);
      }
    }
    return due;
  }

  /** One resolution pass: submit the due leg for every due mission, bounded concurrency. */
  async tick(): Promise<void> {
    // Never let two ticks overlap (resolve timer + sweep timer both call this): a concurrent tick
    // would pull a fresh `pending` nonce for a different mission while this one is mid-submit and
    // collide. Skip; the next scheduled tick picks up whatever is still due.
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
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
    } finally {
      this.ticking = false;
    }
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
    const { missionId, leg } = mission;
    // Idempotency guard: skip if it raced into flight, got settled, or changed leg between scan and
    // submit (so we never double-submit the same (missionId, leg)).
    const current = this.pending.get(missionId);
    if (this.inFlight.has(missionId) || !current || current.leg !== leg) {
      return;
    }
    this.inFlight.add(missionId);
    try {
      const hash = await this.resolver.resolveMission(missionId, leg);
      this.resolvedCount += 1;
      this.lastResolvedMissionId = missionId;
      this.lastResolvedAt = new Date(this.now() * 1_000).toISOString();
      this.lastError = null;
      this.logger.info("[keeper] resolved mission leg", { missionId, leg, hash });
      // Our submit succeeded. The authoritative event (FleetMissionResolved / FleetMissionReturned)
      // is the backstop, but advance the state machine now so we don't keep re-submitting.
      if (leg === "arrival") {
        this.recordArrivalResolved({
          missionId,
          missionType: mission.missionType,
          returnAt: mission.returnAt
        });
      } else {
        this.recordReturned(missionId);
      }
    } catch (error) {
      this.submitFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastErrorAt = new Date(this.now() * 1_000).toISOString();
      if (error instanceof MissionNotResolvableError) {
        // Expected: arrival randomness not committed yet, or return not due / wrong status / lost a
        // race. Keep this leg pending and retry next tick.
        this.logger.warn("[keeper] mission leg not resolvable yet, will retry", {
          missionId,
          leg,
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
   * the WS feed may have missed; existing/terminal ones are ignored by recordLaunched. */
  reconcilePending(resolvable: LaunchedMission[]): void {
    for (const mission of resolvable) {
      this.recordLaunched(mission);
    }
  }

  snapshot(): KeeperSnapshot {
    let awaitingArrivalCount = 0;
    let awaitingReturnCount = 0;
    for (const mission of this.pending.values()) {
      if (mission.leg === "return") {
        awaitingReturnCount += 1;
      } else {
        awaitingArrivalCount += 1;
      }
    }
    return {
      pendingCount: this.pending.size,
      awaitingArrivalCount,
      awaitingReturnCount,
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
