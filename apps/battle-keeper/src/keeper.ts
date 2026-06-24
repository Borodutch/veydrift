import {
  FleetMissionStatus,
  hasReturnLegAfterArrival,
  keeperResolvableMissionTypes,
  MissionType,
  missionTypeNames
} from "./events";
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
  /** Stored return timestamp from launch; only return-leg mission types use it for a return leg. */
  returnAt: number;
  /** Randomness request id for normal attacks; ACS attack joiners store the main attack mission id. */
  randomnessRequestId?: string;
};

/** A mission tracked in the pending set, currently awaiting one specific leg. */
export type PendingMission = {
  missionId: string;
  missionType: number;
  /** Which leg we are waiting to resolve next. */
  leg: MissionLeg;
  /** Unix seconds when {@link leg} becomes resolvable (arrivalAt for "arrival", returnAt for "return"). */
  dueAt: number;
  /** Known return time (from the launch event, refined by FleetMissionResolved). */
  returnAt: number;
  /** For ACS attack joiners, the main attack mission that must resolve first. */
  blockedByMissionId?: string;
};

export type PendingMissionDiagnostic = {
  missionId: string;
  missionType: number;
  missionTypeName: string;
  leg: MissionLeg;
  dueAt: string;
  dueAgeSeconds: number;
  retryCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type MissionStatusSnapshot = {
  missionId: string;
  status: number;
  missionType: number;
  arrivalAt: number;
  returnAt: number;
  randomnessRequestId?: string;
};

export type KeeperSnapshot = {
  pendingCount: number;
  awaitingArrivalCount: number;
  awaitingReturnCount: number;
  dueMissionCount: number;
  oldestDueAt: string | null;
  oldestDueMissionId: string | null;
  oldestDueMissionLeg: MissionLeg | null;
  oldestDueAgeSeconds: number | null;
  inFlightCount: number;
  resolvedCount: number;
  submitFailureCount: number;
  lastErrorMissionId: string | null;
  lastErrorLeg: MissionLeg | null;
  lastResolvedMissionId: string | null;
  lastResolvedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  keeperAddress: string;
  pendingMissionIds: string[];
  dueMissions: PendingMissionDiagnostic[];
};

export type BattleKeeperOptions = {
  maxConcurrency?: number;
  now?: () => number;
  logger?: KeeperLogger;
  acsJoinerRetryDelaySeconds?: number;
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
  private readonly knownMissionTypes = new Map<string, number>();
  private readonly maxConcurrency: number;
  private readonly now: () => number;
  private readonly logger: KeeperLogger;
  private readonly acsJoinerRetryDelaySeconds: number;
  /** Re-entrancy guard so overlapping timers (resolve loop + sweep) never run tick() concurrently —
   * concurrent ticks would submit different missions in parallel and collide on the keeper EOA nonce. */
  private ticking = false;

  private resolvedCount = 0;
  private submitFailureCount = 0;
  private lastResolvedMissionId: string | null = null;
  private lastResolvedAt: string | null = null;
  private lastErrorMissionId: string | null = null;
  private lastErrorLeg: MissionLeg | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private readonly retryDiagnostics = new Map<string, {
    retryCount: number;
    lastError: string;
    lastErrorAt: string;
  }>();

  constructor(
    private readonly resolver: MissionResolver,
    options: BattleKeeperOptions = {}
  ) {
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.logger = options.logger ?? consoleLogger;
    this.acsJoinerRetryDelaySeconds = options.acsJoinerRetryDelaySeconds ?? 30;
  }

  /** Record a launched mission into the awaiting-arrival leg. No-op for a non-resolvable type, or a
   * mission we have already settled or are already tracking (any leg). */
  recordLaunched(mission: LaunchedMission): void {
    if (!keeperResolvableMissionTypes.has(mission.missionType)) {
      return;
    }
    this.knownMissionTypes.set(mission.missionId, mission.missionType);
    if (this.terminal.has(mission.missionId) || this.pending.has(mission.missionId)) {
      return;
    }
    const blocker = blockedByMissionId(mission);
    this.pending.set(mission.missionId, {
      missionId: mission.missionId,
      missionType: mission.missionType,
      leg: "arrival",
      dueAt: mission.arrivalAt,
      returnAt: mission.returnAt,
      ...(blocker ? { blockedByMissionId: blocker } : {})
    });
    this.logger.info("[keeper] queued mission (arrival)", {
      missionId: mission.missionId,
      missionType: missionTypeNames[mission.missionType] ?? mission.missionType,
      arrivalAt: mission.arrivalAt,
      returnAt: mission.returnAt
    });
  }

  /** The arrival leg is done (observed FleetMissionResolved, or our own successful resolve). If the
   * mission type has a return leg and returnAt > 0, transition it to awaiting-return with the
   * authoritative returnAt; otherwise it is terminal. Idempotent and safe even if we never saw the
   * launch. */
  recordArrivalResolved(event: { missionId: string; missionType: number; returnAt: number }): void {
    const { missionId, missionType, returnAt } = event;
    this.knownMissionTypes.set(missionId, missionType);
    this.inFlight.delete(missionId);
    if (this.terminal.has(missionId)) {
      return;
    }
    this.clearRetryDiagnostics(missionId, "arrival");
    if (hasReturnLegAfterArrival(missionType, returnAt)) {
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

  /** Authoritative signal that a resolved arrival actually became a return leg. This covers cases
   * where `FleetMissionResolved.returnAt` is nonzero for both terminal and returning outcomes
   * (notably Colonize); the contract emits this event only for Returning/Recalled missions. */
  recordReturnExposed(event: { missionId: string; status: number; returnAt: number }): void {
    const { missionId, status, returnAt } = event;
    if (
      status !== FleetMissionStatus.Returning &&
      status !== FleetMissionStatus.Recalled
    ) {
      return;
    }
    if (returnAt <= 0) {
      return;
    }

    const existing = this.pending.get(missionId);
    this.terminal.delete(missionId);
    this.pending.set(missionId, {
      missionId,
      missionType: existing?.missionType ?? this.knownMissionTypes.get(missionId) ?? -1,
      leg: "return",
      dueAt: returnAt,
      returnAt
    });
    this.logger.info("[keeper] return exposed, awaiting return", { missionId, returnAt });
  }

  /** DefenseHold launch events expose travel arrival, but the permissionless resolve call is only
   * valid after the stationing hold window ends. The companion DefenseHoldStationed event carries
   * the exact `holdUntil`; use it so a holding fleet does not retry every tick while still active. */
  recordDefenseHoldStationed(event: { missionId: string; holdUntil: number; returnAt: number }): void {
    const { missionId, holdUntil, returnAt } = event;
    if (this.terminal.has(missionId)) {
      return;
    }

    this.knownMissionTypes.set(missionId, MissionType.DefenseHold);
    const existing = this.pending.get(missionId);
    if (existing && existing.leg !== "arrival") {
      return;
    }

    this.pending.set(missionId, {
      missionId,
      missionType: MissionType.DefenseHold,
      leg: "arrival",
      dueAt: holdUntil,
      returnAt
    });
    this.logger.info("[keeper] defense hold stationed, awaiting hold end", {
      missionId,
      holdUntil,
      returnAt
    });
  }

  /** The return leg is done (FleetMissionReturned). Drop the mission — it is terminal. */
  recordReturned(missionId: string): void {
    const wasTracked = this.pending.delete(missionId);
    this.inFlight.delete(missionId);
    this.clearRetryDiagnostics(missionId);
    if (!this.terminal.has(missionId)) {
      this.terminal.add(missionId);
      if (wasTracked) {
        this.logger.info("[keeper] return resolved (terminal)", { missionId });
      }
    }
  }

  /** Reconcile one tracked mission against the authoritative on-chain status. This prunes stale
   * terminal ids (Resolved/Returned/None), corrects an arrival that already became Returning/Recalled,
   * and moves a wrongly-tracked return back to arrival if the chain still says Outbound. */
  reconcileMissionStatus(status: MissionStatusSnapshot): void {
    const current = this.pending.get(status.missionId);
    if (!current || this.inFlight.has(status.missionId)) {
      return;
    }

    if (status.status === FleetMissionStatus.Outbound) {
      if (current.leg !== "arrival") {
        const blocker = blockedByMissionId(status);
        this.clearRetryDiagnostics(status.missionId, current.leg);
        this.pending.set(status.missionId, {
          missionId: status.missionId,
          missionType: status.missionType,
          leg: "arrival",
          dueAt: status.arrivalAt,
          returnAt: status.returnAt,
          ...(blocker ? { blockedByMissionId: blocker } : {})
        });
        this.logger.warn("[keeper] corrected pending mission back to arrival from on-chain status", {
          missionId: status.missionId,
          arrivalAt: status.arrivalAt,
          returnAt: status.returnAt
        });
      }
      return;
    }

    if (
      (status.status === FleetMissionStatus.Returning || status.status === FleetMissionStatus.Recalled)
      && status.returnAt > 0
    ) {
      this.knownMissionTypes.set(status.missionId, status.missionType);
      if (current.leg !== "return") {
        this.clearRetryDiagnostics(status.missionId, current.leg);
      }
      this.pending.set(status.missionId, {
        missionId: status.missionId,
        missionType: status.missionType,
        leg: "return",
        dueAt: status.returnAt,
        returnAt: status.returnAt
      });
      return;
    }

    const wasTracked = this.pending.delete(status.missionId);
    this.clearRetryDiagnostics(status.missionId);
    this.terminal.add(status.missionId);
    if (wasTracked) {
      this.logger.warn("[keeper] pruned stale pending mission from on-chain status", {
        missionId: status.missionId,
        status: status.status,
        missionType: missionTypeNames[status.missionType] ?? status.missionType,
        trackedLeg: current.leg
      });
    }
  }

  pendingMissions(): PendingMission[] {
    return [...this.pending.values()];
  }

  /** Missions whose current leg is due and that are not currently being submitted. */
  private dueMissions(): PendingMission[] {
    const nowSeconds = this.now();
    const due: PendingMission[] = [];
    for (const mission of this.pending.values()) {
      if (
        mission.dueAt <= nowSeconds
        && !this.inFlight.has(mission.missionId)
        && !this.hasUnresolvedArrivalBlocker(mission)
      ) {
        due.push(mission);
      }
    }
    return due.sort(compareDueMissions);
  }

  private hasUnresolvedArrivalBlocker(mission: PendingMission): boolean {
    if (mission.leg !== "arrival" || !mission.blockedByMissionId) {
      return false;
    }
    const blocker = this.pending.get(mission.blockedByMissionId);
    return Boolean(blocker && blocker.leg === "arrival");
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
      if (leg === "arrival") {
        if (mission.missionType === MissionType.AcsAttack && mission.blockedByMissionId) {
          // A joined ACS attack's resolve call is a successful no-op while the main attack is still
          // Outbound. Wait for FleetMissionResolved/FleetMissionReturnExposed or status reconcile
          // before moving it to return, otherwise the keeper will spam failing return completions.
          const current = this.pending.get(missionId);
          if (current?.leg === "arrival") {
            this.pending.set(missionId, {
              ...current,
              dueAt: this.now() + this.acsJoinerRetryDelaySeconds
            });
          }
          this.logger.info("[keeper] ACS joiner arrival submitted; awaiting authoritative status", {
            missionId,
            blockedByMissionId: mission.blockedByMissionId,
            hash
          });
          return;
        }
      }
      this.resolvedCount += 1;
      this.lastResolvedMissionId = missionId;
      this.lastResolvedAt = new Date(this.now() * 1_000).toISOString();
      this.lastError = null;
      this.lastErrorMissionId = null;
      this.lastErrorLeg = null;
      this.clearRetryDiagnostics(missionId, leg);
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
      this.lastErrorMissionId = missionId;
      this.lastErrorLeg = leg;
      const retryKey = this.retryKey(missionId, leg);
      const existing = this.retryDiagnostics.get(retryKey);
      this.retryDiagnostics.set(retryKey, {
        retryCount: (existing?.retryCount ?? 0) + 1,
        lastError: this.lastError,
        lastErrorAt: this.lastErrorAt
      });
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
    let dueMissionCount = 0;
    let oldestDueAtSeconds: number | null = null;
    let oldestDueMissionId: string | null = null;
    let oldestDueMissionLeg: MissionLeg | null = null;
    const dueMissions: PendingMissionDiagnostic[] = [];
    const nowSeconds = this.now();
    for (const mission of this.pending.values()) {
      if (mission.leg === "return") {
        awaitingReturnCount += 1;
      } else {
        awaitingArrivalCount += 1;
      }
      if (mission.dueAt <= nowSeconds) {
        dueMissionCount += 1;
        if (oldestDueAtSeconds === null || mission.dueAt < oldestDueAtSeconds) {
          oldestDueAtSeconds = mission.dueAt;
          oldestDueMissionId = mission.missionId;
          oldestDueMissionLeg = mission.leg;
        }
        const retry = this.retryDiagnostics.get(this.retryKey(mission.missionId, mission.leg));
        dueMissions.push({
          missionId: mission.missionId,
          missionType: mission.missionType,
          missionTypeName: missionTypeNames[mission.missionType] ?? `unknown:${mission.missionType}`,
          leg: mission.leg,
          dueAt: new Date(mission.dueAt * 1_000).toISOString(),
          dueAgeSeconds: Math.max(0, nowSeconds - mission.dueAt),
          retryCount: retry?.retryCount ?? 0,
          lastError: retry?.lastError ?? null,
          lastErrorAt: retry?.lastErrorAt ?? null
        });
      }
    }
    dueMissions.sort((left, right) => {
      if (right.dueAgeSeconds !== left.dueAgeSeconds) {
        return right.dueAgeSeconds - left.dueAgeSeconds;
      }
      return Number(left.missionId) - Number(right.missionId);
    });
    return {
      pendingCount: this.pending.size,
      awaitingArrivalCount,
      awaitingReturnCount,
      dueMissionCount,
      oldestDueAt:
        oldestDueAtSeconds === null ? null : new Date(oldestDueAtSeconds * 1_000).toISOString(),
      oldestDueMissionId,
      oldestDueMissionLeg,
      oldestDueAgeSeconds:
        oldestDueAtSeconds === null ? null : Math.max(0, nowSeconds - oldestDueAtSeconds),
      inFlightCount: this.inFlight.size,
      resolvedCount: this.resolvedCount,
      submitFailureCount: this.submitFailureCount,
      lastErrorMissionId: this.lastErrorMissionId,
      lastErrorLeg: this.lastErrorLeg,
      lastResolvedMissionId: this.lastResolvedMissionId,
      lastResolvedAt: this.lastResolvedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      keeperAddress: this.resolver.keeperAddress(),
      pendingMissionIds: [...this.pending.keys()],
      dueMissions
    };
  }

  private retryKey(missionId: string, leg: MissionLeg): string {
    return `${missionId}:${leg}`;
  }

  private clearRetryDiagnostics(missionId: string, leg?: MissionLeg): void {
    if (leg) {
      this.retryDiagnostics.delete(this.retryKey(missionId, leg));
      return;
    }
    this.retryDiagnostics.delete(this.retryKey(missionId, "arrival"));
    this.retryDiagnostics.delete(this.retryKey(missionId, "return"));
  }
}

function blockedByMissionId(mission: {
  missionId: string;
  missionType: number;
  randomnessRequestId?: string;
}): string | undefined {
  if (mission.missionType !== MissionType.AcsAttack) {
    return undefined;
  }
  const blocker = mission.randomnessRequestId;
  if (!blocker || blocker === "0" || blocker === mission.missionId) {
    return undefined;
  }
  return blocker;
}

function compareDueMissions(a: PendingMission, b: PendingMission): number {
  if (a.leg !== b.leg) {
    return a.leg === "arrival" ? -1 : 1;
  }
  if (a.leg === "arrival" && b.leg === "arrival") {
    const aJoiner = a.missionType === MissionType.AcsAttack ? 1 : 0;
    const bJoiner = b.missionType === MissionType.AcsAttack ? 1 : 0;
    if (aJoiner !== bJoiner) {
      return aJoiner - bJoiner;
    }
  }
  if (a.dueAt !== b.dueAt) {
    return a.dueAt - b.dueAt;
  }
  return BigInt(a.missionId) < BigInt(b.missionId) ? -1 : BigInt(a.missionId) > BigInt(b.missionId) ? 1 : 0;
}
