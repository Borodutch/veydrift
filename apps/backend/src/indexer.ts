import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildingIds,
  defenseIds,
  allianceRoleIds,
  shipIds,
  technologyIds
} from "./contractStateSchema";
import {
  attachAttackGroupParticipants,
  decodeAllianceLog,
  decodeAttackMissionLaunch,
  decodeBattleReports,
  decodeCompleteFleetMissionLogs,
  decodeDebrisFieldLog,
  decodeIndexedQueueCompletedLog,
  decodeIndexedQueueStartedLog,
  decodeMoonCreatedLog,
  decodeMoonChanceReportLog,
  decodePlanetSettledLog,
  decodePlanetRenamedLog,
  decodeFleetMissionLogs,
  decodeRandomnessFulfilledRequestId,
  decodeRiftResourceLog,
  decodeSettledPlanetLog,
  decodeShipCountChangedLog,
  decodeDefenseCountChangedLog,
  fleetMissionNeedsResolution,
  missionBattleRandomnessRequestId,
  isDebrisFieldLog,
  isRandomnessFulfilledLog,
  isBattleReportLog,
  isFleetMissionLog,
  isIndexedQueueCompletedLog,
  isIndexedQueueStartedLog,
  isAllianceLog,
  isMoonCreatedLog,
  isMoonChanceReportLog,
  isPlanetSettledLog,
  isPlanetRenamedLog,
  isRiftResourceLog,
  isSettledPlanetLog,
  isShipCountChangedLog,
  isDefenseCountChangedLog,
  type ChainReader,
  type Address,
  type AllianceIdentity,
  type AllianceState,
  type AllianceJoinRequestSnapshot,
  type AllianceInviteSnapshot,
  type AllianceDiplomacySnapshot,
  type BattleReport,
  type DebrisFieldEvent,
  type DefenseState,
  type FleetMissionPlanetReference,
  type FleetMissionVisibility,
  type FleetMissionSummary,
  type StationedDefenderSummary,
  type IndexedQueueCompletedEvent,
  type IndexedQueueStartedEvent,
  type IndexedAllianceEvent,
  type IndexedMoonCreatedEvent,
  type IndexedRiftResourceEvent,
  type IndexedShipCountChangedEvent,
  type IndexedDefenseCountChangedEvent,
  type InfrastructureState,
  type ManagedPlanet,
  type MoonState,
  type MoonChanceReportEvent,
  type PlanetSettledEvent,
  type PlanetRenamedEvent,
  type PlayerQueues,
  type QueueState,
  type ResearchState,
  type Resources,
  riftRequirements,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  type WalletPlanets
} from "./evm";
import {
  calculateIndexedHighscore,
  deriveInfrastructureFields,
  deriveBuildingRows,
  deriveDefenseRows,
  deriveShipRows,
  deriveTechnologyRows,
  usedFieldsFromBuildingRows,
  zeroResources
} from "./readModels";
import type { HighscoreEntry } from "./highscores";
import { playerFallbackName, type PlayerProfile } from "./playerProfiles";
import { planetArchetypeForTemperature } from "./universe";
import { nowSeconds, settleQueueAsOfNow, withMissionAsOfNow } from "./asOfNow";

export type IndexedDebrisFieldEvent = DebrisFieldEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;
export type IndexedMoonChanceReportEvent = MoonChanceReportEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;

export type IndexerSnapshot = {
  allianceReconciledAt: string | null;
  allianceStaleReason: string | null;
  indexedDebrisFields: number;
  indexedEventLogs: number;
  indexedMoonChanceReports: number;
  indexedMoons: number;
  indexedPlanets: number;
  indexedState: "healthy" | "reconciling" | "stale";
  indexedRiftBalances: number;
  fromBlock: string;
  lastRebuiltAt: string | null;
  lastReconciledAt: string | null;
  lastReconciledBlock: string | null;
  lastReconciliationError: string | null;
  latestIndexedBlock: string | null;
  pendingReconciliationReason: string | null;
  reconciliationInProgress: boolean;
  reorgDetectedAt: string | null;
  safeToServeAllianceState: boolean;
  safeToServeIndexedState: boolean;
  staleReason: string | null;
};

export type SettlementIndexerOptions = {
  database?: Database;
  databasePath?: string;
  // VEY-KANEO-471: when true, fleetMissionVisibility appends one synthetic incoming attack with a
  // populated `stationedDefenders` payload so QA can verify the Stationed defenses panel without a
  // real ≥2-wallet on-chain ACS Defend scenario. Sourced from config.qaSyntheticStationedDefenders,
  // which is already hard-gated to non-production. Defaults to false.
  qaSyntheticStationedDefenders?: boolean;
  // VEY-KANEO-479: when true (the randomness engine is configured for this deployment), an arrived
  // Attack's `needsResolution` is gated on its battle randomness being fulfilled — derived from the
  // ingested RandomnessFulfilled logs. When false, no randomness data is expected and readiness stays
  // on the plain arrival check, preserving behaviour for deployments without the engine.
  randomnessEngineConfigured?: boolean;
  // VEY-KANEO-485: hard deadline (ms) for the chain-read phase of a full cold rebuild. The self-hosted
  // node is the only RPC and caps eth_getLogs at 100k blocks; if the deploy->head backfill stalls, the
  // rebuild rejects with a real error (recorded as lastReconciliationError, retried by the boot-time
  // recovery) instead of sitting in reconciliation_in_progress forever. Omitted/<=0 disables the
  // deadline (the in-memory test indexer has no slow RPC to guard).
  rebuildDeadlineMs?: number;
};

type CountRow = {
  count: number;
};

type MetadataRow = {
  value: string;
};

type EventRow = {
  event_json: string;
};

type QueueRow = {
  backlog_json: string | null;
  crystal_cost: string;
  deuterium_cost: string;
  item_id: number;
  metal_cost: string;
  queue_kind: string;
  quantity: number | null;
  ready_at: string;
  started_at: string | null;
  target_level: number | null;
};

type LegacyQueueRow = {
  cost_json: string;
  event_json: string;
  item_id: number;
  kind: string;
  owner: string | null;
  planet_id: string | null;
  quantity: number | null;
  queue_key: string;
  ready_at: string;
  started_at: string | null;
  target_level: number | null;
};

type LevelRow = {
  id: number;
  value: number;
};

type IndexedPlanetLevelRow = LevelRow & {
  planet_id: string;
};

type IndexedTechnologyLevelRow = LevelRow & {
  owner: string;
};

type MoonRow = {
  event_json: string;
};

type RiftBalanceRow = {
  in_game_balance: string;
  locked_balance: string;
  resource_id: number;
};

type PendingWithdrawalRow = {
  amount: string;
  resource_id: number;
  unlocks_at: string;
  withdrawal_key: string;
};

type MoonBuildingQueueRow = {
  crystal_cost: string;
  deuterium_cost: string;
  event_json: string;
  metal_cost: string;
  moon_building_id: number;
  planet_id: string;
  ready_at: string;
  target_level: number;
};

type ResourceColumns = {
  metal: string;
  crystal: string;
  deuterium: string;
};

type PlanetResourceRow = ResourceColumns & {
  block_number: string;
  last_settled_at: string;
  transaction_hash: string;
};

type PlayerProfileRow = {
  display_name: string | null;
  updated_at: string | null;
  wallet: string;
};

type PlayerActivityRow = {
  last_active_at: string;
  wallet: string;
};

type AllianceRow = {
  active: number;
  alliance_id: string;
  created_at: string;
  description: string;
  member_count: number;
  name: string;
  owner: string;
  tag: string;
};

type AllianceMemberRow = {
  alliance_id: string;
  joined_at: string;
  role_id: number;
  wallet: string;
};

type AllianceInviteRow = {
  alliance_id: string;
  invited_at: string;
  inviter: string;
  player: string;
};

type AllianceJoinRequestRow = {
  alliance_id: string;
  requested_at: string;
  requester: string;
};

type QueueUpsertEvent = IndexedQueueStartedEvent & {
  backlog?: QueueState[];
};

export type IndexedRpcLog = RpcLog & {
  blockTimestamp?: string;
  logIndex?: string;
  removed?: boolean;
};

export type ApplyLogResult = {
  applied: boolean;
  duplicate: boolean;
  ignored: boolean;
  removed: boolean;
  snapshot: IndexerSnapshot;
};

// How many planets the canonical reconcile reads at once. Each planet fans out 4 batched eth_call reads,
// so this bounds the concurrent batches the self-hosted RPC node has to serialize and return intact —
// reading the whole universe in one Promise.all truncated responses and failed the reconcile
// (VEY-KANEO-461). 25 keeps the reconcile completing without making it serial-slow.
const CANONICAL_READ_PLANET_CHUNK = 25;


export class SettlementIndexer {
  private readonly db: Database;
  private planetRebuildPromise: Promise<IndexerSnapshot> | null = null;
  private rebuildPromise: Promise<IndexerSnapshot> | null = null;
  // Monotonic counter bumped by touch() on every applied state mutation. Read paths memoize
  // whole-universe derivations against it and recompute only when integrated events actually
  // changed state — never per request (VEY-KANEO-467).
  private stateGeneration = 0;
  // Memoized full highscore leaderboard (every owner's score + their planets). The leaderboard is a
  // pure function of indexed state (no time/accrual component), so it is valid until the next
  // touch(); see highscoreLeaderboard / stateVersion.
  private leaderboardCache:
    | { generation: number; planetsByOwner: Map<string, SettledPlanetEvent[]>; entries: HighscoreEntry[] }
    | null = null;

  constructor(
    private readonly chainReader: Pick<
      ChainReader,
      "listDebrisFieldEvents" | "listMoonChanceReportEvents" | "listSettledPlanetEvents"
    > & Pick<
      Partial<ChainReader>,
      "getDefenseState"
        | "getInfrastructureState"
        | "getMoonState"
        | "getPlayerQueues"
        | "getResearchState"
        | "getShipyardState"
        | "listAllianceDirectoryState"
        | "listAllianceJoinRequestState"
        | "listAllianceInviteState"
        | "listAllianceDiplomacyState"
        | "listAllianceLogs"
        | "listContractLogs"
        | "listCurrentPlanets"
    >,
    private readonly fromBlock: bigint,
    options: SettlementIndexerOptions = {}
  ) {
    this.db = options.database ?? openIndexerDatabase(options.databasePath ?? ":memory:");
    this.qaSyntheticStationedDefenders = options.qaSyntheticStationedDefenders ?? false;
    this.randomnessEngineConfigured = options.randomnessEngineConfigured ?? false;
    this.rebuildDeadlineMs = options.rebuildDeadlineMs && options.rebuildDeadlineMs > 0 ? options.rebuildDeadlineMs : 0;
    this.migrate();
  }

  // VEY-KANEO-471: see SettlementIndexerOptions. Read once in fleetMissionVisibility.
  private readonly qaSyntheticStationedDefenders: boolean;
  // VEY-KANEO-479: see SettlementIndexerOptions. Gates arrived-Attack readiness on randomness.
  private readonly randomnessEngineConfigured: boolean;
  // VEY-KANEO-485: see SettlementIndexerOptions. 0 = no cold-rebuild deadline.
  private readonly rebuildDeadlineMs: number;

  snapshot(): IndexerSnapshot {
    const reconciliationInProgress = this.rebuildPromise !== null || this.planetRebuildPromise !== null;
    const indexedPlanets = this.count("indexed_planets");
    const lastReconciledAt = this.metadata("lastReconciledAt");
    const allianceReconciledAt = this.metadata("allianceReconciledAt") ?? lastReconciledAt;
    const lastReconciledBlock = this.metadata("lastReconciledBlock");
    const lastReconciliationError = this.metadata("lastReconciliationError");
    const pendingReconciliationReason = this.metadata("pendingReconciliationReason");
    const blockingStaleReason = this.blockingStaleReason({
      lastReconciledAt,
      lastReconciliationError,
      pendingReconciliationReason
    });
    const staleReason = reconciliationInProgress ? "reconciliation_in_progress" : blockingStaleReason;
    const canServePreviousReconciliation =
      reconciliationInProgress
      && Boolean(lastReconciledAt)
      && isPlanetHydrationPendingReason(blockingStaleReason);
    const safeToServeIndexedState =
      (blockingStaleReason === null || canServePreviousReconciliation)
      && (!reconciliationInProgress || Boolean(lastReconciledAt));
    const allianceStaleReason = this.allianceStaleReason({
      allianceReconciledAt,
      lastReconciliationError,
      reconciliationInProgress
    });
    return {
      allianceReconciledAt,
      allianceStaleReason,
      indexedDebrisFields: this.count("indexed_debris_fields"),
      indexedEventLogs: this.count("indexed_event_logs"),
      indexedMoonChanceReports: this.count("indexed_moon_chance_reports"),
      indexedMoons: this.count("indexed_moons"),
      indexedPlanets,
      indexedState: safeToServeIndexedState ? "healthy" : reconciliationInProgress ? "reconciling" : "stale",
      indexedRiftBalances: this.count("indexed_rift_balances"),
      fromBlock: this.fromBlock.toString(),
      lastRebuiltAt: this.metadata("lastRebuiltAt"),
      lastReconciledAt,
      lastReconciledBlock,
      lastReconciliationError,
      latestIndexedBlock: this.metadata("latestIndexedBlock"),
      pendingReconciliationReason,
      reconciliationInProgress,
      reorgDetectedAt: this.metadata("reorgDetectedAt"),
      safeToServeAllianceState: allianceStaleReason === null,
      safeToServeIndexedState,
      staleReason
    };
  }

  settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    return this.planetsFromRows(
      "SELECT event_json FROM contract_planets WHERE galaxy = ? AND system_number = ? ORDER BY position ASC",
      galaxy,
      system
    );
  }

  debrisFieldsInSystem(galaxy: number, system: number): IndexedDebrisFieldEvent[] {
    const rows = this.db.query(`
      SELECT debris.event_json
      FROM contract_debris_fields debris
      INNER JOIN contract_planets planet ON planet.planet_id = debris.planet_id
      WHERE planet.galaxy = ? AND planet.system_number = ?
      ORDER BY planet.position ASC
    `).all(galaxy, system) as EventRow[];

    return rows.flatMap((row) => {
      const field = parseEvent<DebrisFieldEvent>(row.event_json);
      const planet = this.planet(field.planetId);
      if (!planet) return [];
      return [{ ...field, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  moonChanceReportsInSystem(galaxy: number, system: number): IndexedMoonChanceReportEvent[] {
    const rows = this.db.query(`
      SELECT report.event_json
      FROM contract_moon_chance_reports report
      INNER JOIN contract_planets planet ON planet.planet_id = report.target_planet_id
      WHERE planet.galaxy = ? AND planet.system_number = ?
      ORDER BY planet.position ASC, report.block_number ASC
    `).all(galaxy, system) as EventRow[];

    return rows.flatMap((row) => {
      const report = parseEvent<MoonChanceReportEvent>(row.event_json);
      const planet = this.planet(report.targetPlanetId);
      if (!planet) return [];
      return [{ ...report, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  settledPlanets(): SettledPlanetEvent[] {
    return this.planetsFromRows("SELECT event_json FROM contract_planets ORDER BY CAST(planet_id AS INTEGER) ASC");
  }

  settledPlanetsByOwner(): Map<string, SettledPlanetEvent[]> {
    const planetsByOwner = new Map<string, SettledPlanetEvent[]>();
    for (const planet of this.settledPlanets()) {
      const owner = planet.owner.toLowerCase();
      planetsByOwner.set(owner, [...(planetsByOwner.get(owner) ?? []), planet]);
    }
    return planetsByOwner;
  }

  planet(planetId: string): SettledPlanetEvent | null {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(planetId) as EventRow | null;
    return row ? this.withResourceSnapshot(parseEvent<SettledPlanetEvent>(row.event_json)) : null;
  }

  hasPendingPlanetResources(planetId: string): boolean {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(planetId) as EventRow | null;
    if (!row) return false;
    return isZeroResourcePlaceholder(parseEvent<SettledPlanetEvent>(row.event_json))
      && !this.planetResourceSnapshot(planetId);
  }

  playerProfile(wallet: string): PlayerProfile {
    const normalizedWallet = wallet.toLowerCase() as Address;
    const row = this.db.query(`
      SELECT wallet, display_name, updated_at
      FROM player_profiles
      WHERE wallet = lower(?)
    `).get(wallet) as PlayerProfileRow | null;

    return {
      wallet: normalizedWallet,
      displayName: row?.display_name ?? null,
      fallbackName: playerFallbackName(normalizedWallet),
      updatedAt: row?.updated_at ?? null
    };
  }

  playerProfiles(wallets: Iterable<string>): Map<string, PlayerProfile> {
    const uniqueWallets = [...new Set([...wallets].map((wallet) => wallet.toLowerCase()))];
    return new Map(uniqueWallets.map((wallet) => [wallet, this.playerProfile(wallet)]));
  }

  playerLastActiveSeconds(wallets: Iterable<string>): Map<string, number> {
    const uniqueWallets = [...new Set([...wallets].map((wallet) => wallet.toLowerCase()))];
    const activity = new Map<string, number>();
    for (const walletChunk of chunks(uniqueWallets, 500)) {
      if (walletChunk.length === 0) continue;
      const rows = this.db.query(`
        SELECT wallet, last_active_at
        FROM indexed_player_activity
        WHERE wallet IN (${walletChunk.map(() => "?").join(",")})
      `).all(...walletChunk) as PlayerActivityRow[];
      for (const row of rows) {
        const seconds = Number(row.last_active_at);
        if (Number.isFinite(seconds) && seconds > 0) {
          activity.set(row.wallet.toLowerCase(), seconds);
        }
      }
    }
    return activity;
  }

  allianceState(wallet: `0x${string}`): AllianceState {
    const normalizedWallet = wallet.toLowerCase() as Address;
    const membership = this.allianceMembership(normalizedWallet);
    const directory = this.allianceDirectory();
    const directoryById = new Map(directory.map((alliance) => [alliance.allianceId, alliance]));
    const pendingInvites = this.allianceInvitesForWallet(normalizedWallet);
    const pendingJoinRequests = this.allianceJoinRequestsForWallet(normalizedWallet);
    const members = membership.allianceId === "0" ? [] : this.allianceMembers(membership.allianceId);
    const allianceJoinRequests = membership.allianceId === "0" ? [] : this.allianceJoinRequestsForAlliance(membership.allianceId);
    const profile = membership.allianceId === "0" ? null : directoryById.get(membership.allianceId) ?? null;

    return {
      wallet,
      allianceAvailable: true,
      dismissJoinRequestAvailable: process.env.VEYDRIFT_ALLIANCE_DISMISS_JOIN_REQUEST_ENABLED !== "false",
      membership,
      profile: profile ? {
        active: profile.active,
        tag: profile.tag,
        name: profile.name,
        description: profile.description,
        owner: profile.owner,
        createdAt: profile.createdAt,
        memberCount: profile.memberCount,
        ...(profile.ownerDisplayName !== undefined ? { ownerDisplayName: profile.ownerDisplayName } : {}),
        ...(profile.totalMemberScore !== undefined ? { totalMemberScore: profile.totalMemberScore } : {})
      } : null,
      directory,
      pendingInvites,
      pendingJoinRequests,
      allianceJoinRequests,
      members
    };
  }

  allianceIntelForPlayers(wallets: readonly string[]): Map<string, AllianceIdentity> {
    const uniqueWallets = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))];
    if (uniqueWallets.length === 0) return new Map();

    const rows = this.db.query(`
      SELECT member.wallet, alliance.alliance_id, alliance.tag, alliance.name
      FROM contract_alliance_members member
      INNER JOIN contract_alliances alliance ON alliance.alliance_id = member.alliance_id
      WHERE alliance.active = 1 AND member.wallet IN (${uniqueWallets.map(() => "?").join(",")})
    `).all(...uniqueWallets) as Array<{ wallet: string; alliance_id: string; tag: string; name: string }>;

    return new Map(rows.map((row) => [
      row.wallet.toLowerCase(),
      {
        allianceId: row.alliance_id,
        tag: row.tag,
        name: row.name
      }
    ]));
  }

  upsertPlayerDisplayName(wallet: Address, displayName: string): PlayerProfile {
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO player_profiles (wallet, display_name, updated_at)
      VALUES (lower(?), ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(wallet, displayName, updatedAt);

    return this.playerProfile(wallet);
  }

  private allianceMembership(wallet: Address): AllianceState["membership"] {
    const row = this.db.query(`
      SELECT alliance_id, wallet, role_id, joined_at
      FROM contract_alliance_members
      WHERE wallet = lower(?)
    `).get(wallet) as AllianceMemberRow | null;

    return row ? {
      allianceId: row.alliance_id,
      role: allianceRoleName(row.role_id),
      joinedAt: row.joined_at
    } : {
      allianceId: "0",
      role: "none",
      joinedAt: "0"
    };
  }

  private allianceDirectory(): AllianceState["directory"] {
    const rows = this.db.query(`
      SELECT alliance_id, active, tag, name, description, owner, created_at, member_count
      FROM contract_alliances
      WHERE active = 1
      ORDER BY CAST(alliance_id AS INTEGER) ASC
    `).all() as AllianceRow[];
    return rows.map((row) => {
      const members = this.allianceMembers(row.alliance_id);
      return {
        allianceId: row.alliance_id,
        active: row.active === 1,
        tag: row.tag,
        name: row.name,
        description: row.description,
        owner: row.owner.toLowerCase() as Address,
        ownerDisplayName: this.playerProfile(row.owner).displayName,
        createdAt: row.created_at,
        memberCount: row.member_count,
        totalMemberScore: this.allianceTotalScore(members.map((member) => member.address)),
        members
      };
    });
  }

  private allianceMembers(allianceId: string): NonNullable<AllianceState["directory"][number]["members"]> {
    const rows = this.db.query(`
      SELECT alliance_id, wallet, role_id, joined_at
      FROM contract_alliance_members
      WHERE alliance_id = ?
      ORDER BY CASE role_id WHEN 3 THEN 0 WHEN 2 THEN 1 WHEN 1 THEN 2 ELSE 3 END, joined_at ASC, wallet ASC
    `).all(allianceId) as AllianceMemberRow[];
    return rows.map((row) => {
      const address = row.wallet.toLowerCase() as Address;
      return {
        address,
        displayName: this.playerProfile(address).displayName,
        role: allianceRoleName(row.role_id),
        joinedAt: row.joined_at,
        totalScore: this.walletTotalScore(address)
      };
    });
  }

  private allianceInvitesForWallet(wallet: Address): AllianceState["pendingInvites"] {
    const rows = this.db.query(`
      SELECT alliance_id, player, inviter, invited_at
      FROM contract_alliance_invites
      WHERE player = lower(?)
      ORDER BY CAST(alliance_id AS INTEGER) ASC
    `).all(wallet) as AllianceInviteRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      inviter: row.inviter.toLowerCase() as Address,
      inviterDisplayName: this.playerProfile(row.inviter).displayName,
      invitedAt: row.invited_at
    }));
  }

  private allianceJoinRequestsForWallet(wallet: Address): AllianceState["pendingJoinRequests"] {
    const rows = this.db.query(`
      SELECT alliance_id, requester, requested_at
      FROM contract_alliance_join_requests
      WHERE requester = lower(?)
      ORDER BY CAST(alliance_id AS INTEGER) ASC
    `).all(wallet) as AllianceJoinRequestRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      requester: row.requester.toLowerCase() as Address,
      requesterDisplayName: this.playerProfile(row.requester).displayName,
      requestedAt: row.requested_at
    }));
  }

  private allianceJoinRequestsForAlliance(allianceId: string): AllianceState["allianceJoinRequests"] {
    const rows = this.db.query(`
      SELECT alliance_id, requester, requested_at
      FROM contract_alliance_join_requests
      WHERE alliance_id = ?
      ORDER BY requested_at ASC, requester ASC
    `).all(allianceId) as AllianceJoinRequestRow[];
    return rows.map((row) => ({
      allianceId: row.alliance_id,
      requester: row.requester.toLowerCase() as Address,
      requesterDisplayName: this.playerProfile(row.requester).displayName,
      requesterMembership: this.allianceMembership(row.requester.toLowerCase() as Address),
      requestedAt: row.requested_at
    }));
  }

  private allianceTotalScore(wallets: readonly Address[]): string {
    return wallets.reduce((sum, wallet) => sum + BigInt(this.walletTotalScore(wallet)), 0n).toString();
  }

  private walletTotalScore(wallet: Address): string {
    try {
      return this.highscoreForWallet(wallet).score.total;
    } catch {
      return "0";
    }
  }

  walletSettlement(wallet: `0x${string}`): { wallet: `0x${string}`; hasFirstPlanet: boolean; homePlanetId: string | null; planet: SettledPlanetEvent | null; contractKind: "game" } {
    const planets = this.planetsFromRows(
      "SELECT event_json FROM contract_planets WHERE owner = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
      wallet
    );
    const planet = planets.find((item) => item.eventName === "PlanetStarted") ?? planets[0] ?? null;

    return {
      wallet,
      hasFirstPlanet: planet !== null,
      homePlanetId: planet?.planetId ?? null,
      planet,
      contractKind: "game"
    };
  }

  walletPlanets(wallet: `0x${string}`): WalletPlanets {
    const settlement = this.walletSettlement(wallet);
    const planets = this.planetsFromRows(
      "SELECT event_json FROM contract_planets WHERE owner = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
      wallet
    ).map((planet) => indexedManagedPlanet(
      planet,
      settlement.homePlanetId,
      this.infrastructureRows(planet.planetId),
      {
        building: this.planetQueue(planet.planetId, "building"),
        defense: this.planetQueue(planet.planetId, "defense"),
        ship: this.planetQueue(planet.planetId, "ship")
      }
    ));

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      queues: {
        research: this.researchQueue(wallet)
      },
      planets
    };
  }

  playerQueues(wallet: `0x${string}`, planetId: string | null): PlayerQueues {
    return {
      wallet,
      homePlanetId: planetId,
      building: planetId ? this.planetQueue(planetId, "building") : null,
      defense: planetId ? this.planetQueue(planetId, "defense") : null,
      ship: planetId ? this.planetQueue(planetId, "ship") : null,
      research: this.researchQueue(wallet)
    };
  }

  fleetMissionVisibility(wallet: `0x${string}`): FleetMissionVisibility {
    const settlement = this.walletSettlement(wallet);
    const walletLower = wallet.toLowerCase();
    const ownedPlanetIds = new Set(
      this.settledPlanets()
        .filter((planet) => planet.owner.toLowerCase() === walletLower)
        .map((planet) => planet.planetId)
    );
    const summaries = this.indexedFleetMissionSummaries().map((mission) => this.withFleetMissionPlanetReferences(mission));
    const battleReports = this.indexedBattleReports();
    // VEY-KANEO-456: index every mission by id so an incoming attack can resolve the allied AcsDefend
    // fleets stationed against it (linked by `counterplayDefenderMissionIds`) into per-defender detail
    // for the Stationed defenses panel. `nowSeconds` drives the lazy as-of-now reconciliation that hides
    // holds which have already elapsed — derived on read from indexed state, no chain read, no poller.
    const summariesById = new Map(summaries.map((mission) => [mission.missionId, mission]));
    const nowSeconds = Math.floor(Date.now() / 1_000);

    const incoming = summaries
      .filter((mission) =>
        mission.owner.toLowerCase() !== walletLower
          && ownedPlanetIds.has(mission.targetPlanetId)
          && ["Attack", "AcsAttack", "MissileAttack"].includes(mission.missionType)
          && mission.status === "Outbound"
      )
      .map((attack) => ({
        ...attack,
        stationedDefenders: this.stationedDefendersForAttack(attack, summariesById, nowSeconds)
      }));

    // VEY-KANEO-471: prepend a synthetic populated incoming attack so QA can verify the Stationed
    // defenses panel deterministically. Hard-gated to non-production by config, and additionally only
    // emitted when the wallet actually owns a planet to target — so it never fabricates ownership.
    const syntheticIncoming = this.qaSyntheticStationedDefenders
      ? this.syntheticStationedDefenseAttack(wallet, ownedPlanetIds, nowSeconds)
      : null;

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      incoming: syntheticIncoming ? [syntheticIncoming, ...incoming] : incoming,
      outgoing: summaries.filter((mission) =>
        mission.owner.toLowerCase() === walletLower && mission.status === "Outbound"
      ),
      returning: summaries.filter((mission) =>
        mission.owner.toLowerCase() === walletLower
          && (mission.status === "Returning" || mission.status === "Recalled")
      ),
      joinableAttacks: summaries.filter((mission) =>
        mission.owner.toLowerCase() !== walletLower
          && !ownedPlanetIds.has(mission.targetPlanetId)
          && mission.missionType === "Attack"
          && mission.status === "Outbound"
      ),
      completedMissions: summaries
        .filter((mission) => isVisibleCompletedMission(mission, walletLower, ownedPlanetIds))
        .sort(compareFleetMissionsNewestFirst),
      // A report is visible to the main attacker, the defender (target planet owner), and — for a
      // grouped ACS attack — every joiner, so each participant can see the shared report and the loot
      // they personally hauled (VEY-KANEO-432).
      battleReports: battleReports.filter((report) =>
        report.attacker.toLowerCase() === walletLower
          || ownedPlanetIds.has(report.targetPlanetId)
          || report.participants.some((participant) => participant.address.toLowerCase() === walletLower)
      )
    };
  }

  fleetMission(missionId: string): FleetMissionSummary | null {
    const mission = this.indexedFleetMissionSummaries()
      .find((summary) => summary.missionId === missionId);
    return mission ? this.withFleetMissionPlanetReferences(mission) : null;
  }

  stationedDefendersForPlanet(planetId: string, asOfSeconds = Math.floor(Date.now() / 1_000)): StationedDefenderSummary[] {
    return this.indexedFleetMissionSummaries()
      .filter((mission) => this.isActiveDefenseHoldForPlanet(mission, planetId, asOfSeconds))
      .map((mission) => this.stationedDefenderSummary(mission, this.defenseHoldWindowEnd(mission)))
      .sort((left, right) => Number(left.holdUntil) - Number(right.holdUntil));
  }

  stationedDefendersForBattle(
    attack: FleetMissionSummary | null | undefined,
    report: BattleReport | null | undefined
  ): StationedDefenderSummary[] {
    if (!attack && !report) return [];
    const attackArrival = Number(attack?.arrivalAt);
    if (!Number.isFinite(attackArrival)) return [];

    const summaries = this.indexedFleetMissionSummaries();
    const summariesById = new Map(summaries.map((mission) => [mission.missionId, mission]));
    const defenders = new Map<string, StationedDefenderSummary>();

    if (attack) {
      for (const missionId of attack.counterplayDefenderMissionIds ?? []) {
        const defender = summariesById.get(missionId);
        if (!defender || !this.isBattleTimeCounterplay(defender, attack, attackArrival)) continue;
        defenders.set(defender.missionId, this.stationedDefenderSummary(defender, this.counterplayHoldUntil(defender)));
      }
    }

    const targetPlanetId = report?.targetPlanetId ?? attack?.targetPlanetId;
    if (targetPlanetId) {
      for (const defender of summaries) {
        if (!this.isBattleTimeDefenseHoldForPlanet(defender, targetPlanetId, attackArrival)) continue;
        defenders.set(defender.missionId, this.stationedDefenderSummary(defender, this.defenseHoldWindowEnd(defender)));
      }
    }

    return [...defenders.values()].sort((left, right) => Number(left.holdUntil) - Number(right.holdUntil));
  }

  battleReport(missionId: string): BattleReport | null {
    return this.indexedBattleReports().find((report) => report.missionId === missionId) ?? null;
  }

  battleReports(): BattleReport[] {
    return this.indexedBattleReports();
  }

  // Every active mission across the universe (all players), for the Mission Control "All" active tab.
  allActiveFleetMissions(): FleetMissionSummary[] {
    return this.indexedFleetMissionSummaries()
      .filter((mission) => mission.status === "Outbound" || mission.status === "Returning" || mission.status === "Recalled")
      .map((mission) => this.withFleetMissionPlanetReferences(mission))
      .sort(compareFleetMissionsActiveSoonestFirst);
  }

  // Every completed mission across the universe (all players), newest-first, for the past "All" tab.
  allCompletedFleetMissions(): FleetMissionSummary[] {
    return this.indexedFleetMissionSummaries()
      .filter((mission) => mission.status === "Resolved" || mission.status === "Returned")
      .map((mission) => this.withFleetMissionPlanetReferences(mission))
      .sort(compareFleetMissionsNewestFirst);
  }

  infrastructureRows(planetId: string): InfrastructureState["buildings"] {
    // Every building level is served strictly from the contract-authoritative mirror
    // (contract_building_levels), which is raised ONLY by the on-chain completion event
    // (BuildingCompleted -> applyQueueCompletionEffects). We must not optimistically fold an
    // elapsed-but-unfinished build queue entry's targetLevel into the served level: a building
    // upgrade only becomes live on chain once a settling tx (finishBuildingUpgrade / any
    // _settleResources) actually runs, and `buildingLevel(planetId, building)` is a pure view of
    // the stored level — a queue whose off-chain readyAt has merely elapsed does NOT change chain
    // state. Folding targetLevel in here served level N+1 while chain was still at N, a systematic
    // +1 over-count that also poisoned cost/affordability/ETA (VEY-486). Storage buildings were
    // already pinned to the contract level for the same reason (VEY-KANEO-483); this generalizes
    // that to every building type. While the build timer is still running it is surfaced as an
    // active construction (planetQueue); the level itself advances only once the on-chain
    // completion event is indexed.
    return deriveBuildingRows((id) => this.indexedLevel("contract_building_levels", "building_id", planetId, id));
  }

  shipRows(planetId: string, durationLevels?: { shipyardLevel: number; naniteLevel: number }): ShipyardState["ships"] {
    return deriveShipRows(
      (id) => this.asOfNowCount(
        this.indexedLevel("contract_ship_counts", "ship_id", planetId, id),
        this.queueSettlement(`ship:${planetId}`).completed,
        id
      ),
      this.planet(planetId)?.temperature,
      durationLevels
    );
  }

  // Ships physically present at the planet and therefore launchable right now — the value the contract
  // returns from `shipCount(planetId, ship)`. Post the VeydriftGame events upgrade this is identical to
  // `shipRows`: the contract emits PlanetShipCountChanged on EVERY ship-count mutation (the single sink
  // `_setPlanetShipCount` emits it, and launch debits, return credits, and combat losses all route
  // through it), so `contract_ship_counts` is now the authoritative at-planet roster for every mission
  // type — attack/transport/colonize/deploy/acs-defend. The indexer applies those events directly
  // (applyShipCountChangedEvent), so a fleet that has departed is already debited and a fleet that
  // returned (minus combat losses) is already credited, with no departed-ships projection or reconcile
  // needed. Builds emit ShipCompleted, also applied. (VEY-KANEO-461)
  availableShipRows(planetId: string, durationLevels?: { shipyardLevel: number; naniteLevel: number }): ShipyardState["ships"] {
    return deriveShipRows(
      (id) => this.asOfNowCount(
        this.indexedLevel("contract_ship_counts", "ship_id", planetId, id),
        this.queueSettlement(`ship:${planetId}`).completed,
        id
      ),
      this.planet(planetId)?.temperature,
      durationLevels
    );
  }

  // NOTE: the combat-triggered bounded per-planet canonical reconcile (planetReconcileBlock /
  // setPlanetReconcileBlock / drainFleetMissionReconcilePlanets / reconcilePlanetState) has been REMOVED.
  // It re-read a planet's authoritative ship/defense/resource state from the contract on every settled
  // combat fleet mission. Under the canonical-mirror contract NO runtime event may issue an RPC read —
  // contract_* is seeded once at startup and maintained thereafter solely by event-listener callbacks.
  // Ship/defense debits from combat now rely on the contract's PlanetShipCountChanged /
  // PlanetDefenseCountChanged events, which applyShipCountChangedEvent / applyDefenseCountChangedEvent
  // already integrate authoritatively from the event stream.

  defenseRows(planetId: string, durationLevels?: { shipyardLevel: number; naniteLevel: number }): DefenseState["defenses"] {
    return deriveDefenseRows((id) => this.asOfNowCount(
      this.indexedLevel("contract_defense_counts", "defense_id", planetId, id),
      this.queueSettlement(`defense:${planetId}`).completed,
      id
    ), durationLevels);
  }

  technologyLevels(wallet: `0x${string}`): Record<string, number> {
    const rows = this.db.query(`
      SELECT technology_id AS id, level AS value
      FROM contract_technology_levels
      WHERE owner = lower(?)
      ORDER BY technology_id ASC
    `).all(wallet) as LevelRow[];

    const levels = Object.fromEntries(rows.map((row) => [String(row.id), row.value]));
    for (const entry of this.queueSettlement(`research:${wallet.toLowerCase()}`).completed) {
      if (entry.itemId === undefined || entry.targetLevel === undefined) continue;
      const key = String(entry.itemId);
      levels[key] = Math.max(levels[key] ?? 0, entry.targetLevel);
    }
    return levels;
  }

  technologyRows(wallet: `0x${string}`, labLevel?: number): ResearchState["technologies"] {
    const levels = this.technologyLevels(wallet);
    return deriveTechnologyRows((id) => levels[String(id)] ?? 0, labLevel);
  }

  private queueSettlement(queueKeyValue: string) {
    return settleQueueAsOfNow(this.queueState(queueKeyValue), nowSeconds());
  }

  private asOfNowCount(base: number, completed: QueueState[], itemId: number): number {
    return completed
      .filter((entry) => entry.itemId === itemId && entry.quantity !== undefined)
      .reduce((total, entry) => total + (entry.quantity ?? 0), base);
  }

  private moonBuildingLevelAsOfNow(planetId: string, buildingId: number): number {
    // Mirror infrastructureRows (canonical-mirror + VEY-486): serve the moon-building level strictly
    // from the contract-authoritative table (contract_moon_building_levels, seeded at startup from
    // contract reads + raised only by the on-chain completion event), and never fold an
    // elapsed-but-unfinished queue entry's targetLevel — that over-reported the level by +1 before the
    // upgrade was live on chain.
    return this.indexedLevel("contract_moon_building_levels", "moon_building_id", planetId, buildingId);
  }

  highscoreForWallet(wallet: `0x${string}`, planetIds?: string[]): HighscoreEntry {
    const settlement = this.walletSettlement(wallet);
    const ownedPlanets = (planetIds?.length
      ? planetIds.map((planetId) => this.planet(planetId)).filter((planet): planet is SettledPlanetEvent => (
        planet !== null && planet.owner.toLowerCase() === wallet.toLowerCase()
      ))
      : this.rows<SettledPlanetEvent>(
        "SELECT event_json FROM indexed_planets WHERE owner = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
        wallet
      ));

    return calculateIndexedHighscore({
      wallet,
      homePlanetId: settlement.homePlanetId,
      planetCount: ownedPlanets.length,
      planets: ownedPlanets.map((planet) => ({
        buildings: this.infrastructureRows(planet.planetId).map(({ id, level }) => ({ id, level })),
        defenses: this.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })),
        ships: this.shipRows(planet.planetId).map(({ id, count }) => ({ id, count }))
      })),
      technologies: this.technologyRows(wallet).map(({ id, level }) => ({ id, level }))
    });
  }

  highscoreEntriesForOwners(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): HighscoreEntry[] {
    const ownersAndPlanets = [...planetsByOwner.entries()];
    if (ownersAndPlanets.length === 0) return [];

    const planetIds = ownersAndPlanets.flatMap(([, planets]) => planets.map((planet) => planet.planetId));
    const buildingsByPlanet = this.indexedPlanetLevelRows("contract_building_levels", "building_id", "level", planetIds);
    const moonBuildingsByPlanet = this.indexedPlanetLevelRows("contract_moon_building_levels", "moon_building_id", "level", planetIds);
    const defensesByPlanet = this.indexedPlanetLevelRows("contract_defense_counts", "defense_id", "count", planetIds);
    const shipsByPlanet = this.indexedPlanetLevelRows("contract_ship_counts", "ship_id", "count", planetIds);
    const technologiesByOwner = this.indexedTechnologyLevelRows(ownersAndPlanets.map(([owner]) => owner));

    return ownersAndPlanets.map(([owner, planets]) => {
      const homePlanet = planets.find((planet) => planet.eventName === "PlanetStarted") ?? planets[0] ?? null;
      return calculateIndexedHighscore({
        wallet: owner as Address,
        homePlanetId: homePlanet?.planetId ?? null,
        planetCount: planets.length,
        planets: planets.map((planet) => ({
          buildings: levelRows(buildingsByPlanet.get(planet.planetId)),
          moonBuildings: levelRows(moonBuildingsByPlanet.get(planet.planetId)),
          defenses: countRows(defensesByPlanet.get(planet.planetId)),
          ships: countRows(shipsByPlanet.get(planet.planetId))
        })),
        technologies: levelRows(technologiesByOwner.get(owner.toLowerCase()))
      });
    });
  }

  // Whole-universe highscore leaderboard, memoized against the indexer's state generation. The
  // scores depend only on integrated (completed) state, so the same result is valid for every
  // request until the next touch() — turning the rankings / raid-finder hot path from an
  // O(all-planets) recompute per request into an O(1) lookup between block integrations
  // (VEY-KANEO-467). The accrual-to-now projection still runs per request, but only for the
  // bounded set of planets visible on the requested page (see rankedHighscorePlanets).
  highscoreLeaderboard(): { planetsByOwner: Map<string, SettledPlanetEvent[]>; entries: HighscoreEntry[] } {
    const cached = this.leaderboardCache;
    if (cached && cached.generation === this.stateGeneration) {
      return cached;
    }
    const planetsByOwner = this.settledPlanetsByOwner();
    const entries = this.highscoreEntriesForOwners(planetsByOwner);
    this.leaderboardCache = { generation: this.stateGeneration, planetsByOwner, entries };
    return this.leaderboardCache;
  }

  // Monotonic state version, bumped on every applied mutation. Lets read paths key their own
  // memoization off "has the indexed state changed since I last computed this?" (VEY-KANEO-467).
  stateVersion(): number {
    return this.stateGeneration;
  }

  private indexedPlanetLevelRows(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_ship_counts",
    idColumn: "building_id" | "defense_id" | "moon_building_id" | "ship_id",
    valueColumn: "count" | "level",
    planetIds: readonly string[]
  ): Map<string, LevelRow[]> {
    const rowsByPlanet = new Map<string, LevelRow[]>();
    for (const planetIdChunk of chunks([...new Set(planetIds)], 500)) {
      if (planetIdChunk.length === 0) continue;
      const rows = this.db.query(`
        SELECT planet_id, ${idColumn} AS id, ${valueColumn} AS value
        FROM ${table}
        WHERE planet_id IN (${planetIdChunk.map(() => "?").join(",")})
        ORDER BY planet_id ASC, ${idColumn} ASC
      `).all(...planetIdChunk) as IndexedPlanetLevelRow[];
      for (const row of rows) {
        rowsByPlanet.set(row.planet_id, [...(rowsByPlanet.get(row.planet_id) ?? []), { id: row.id, value: row.value }]);
      }
    }
    return rowsByPlanet;
  }

  private indexedTechnologyLevelRows(owners: readonly string[]): Map<string, LevelRow[]> {
    const rowsByOwner = new Map<string, LevelRow[]>();
    const normalizedOwners = [...new Set(owners.map((owner) => owner.toLowerCase()))];
    for (const ownerChunk of chunks(normalizedOwners, 500)) {
      if (ownerChunk.length === 0) continue;
      const rows = this.db.query(`
        SELECT owner, technology_id AS id, level AS value
        FROM contract_technology_levels
        WHERE owner IN (${ownerChunk.map(() => "?").join(",")})
        ORDER BY owner ASC, technology_id ASC
      `).all(...ownerChunk) as IndexedTechnologyLevelRow[];
      for (const row of rows) {
        const owner = row.owner.toLowerCase();
        rowsByOwner.set(owner, [...(rowsByOwner.get(owner) ?? []), { id: row.id, value: row.value }]);
      }
    }
    return rowsByOwner;
  }

  // Lazy on-chain reconciliation (VEY-KANEO-468): the active queue must reflect the as-of-now
  // SETTLED state, not just flag the head "complete". `settleQueueAsOfNow` (via queueSettlement)
  // pops every elapsed active/backlog entry and returns the next genuinely-in-progress queue (or
  // null when all have settled), matching the derived levels/counts (infrastructureRows / shipRows
  // / defenseRows / technologyLevels), which already apply the same completed entries. Flag-only
  // `withQueueAsOfNow` left a finished item lingering in the "active" slot as "Ready".
  planetQueue(planetId: string, kind: "building" | "defense" | "ship"): QueueState | null {
    return this.queueSettlement(`${kind}:${planetId}`).queue;
  }

  moonQueue(planetId: string): QueueState | null {
    return this.queueSettlement(`moon-building:${planetId}`).queue;
  }

  researchQueue(wallet: `0x${string}`): QueueState | null {
    return this.queueSettlement(`research:${wallet.toLowerCase()}`).queue;
  }

  moonState(wallet: `0x${string}`, planetId: string | null): MoonState {
    const moon = planetId ? this.moon(planetId) : null;
    return {
      wallet,
      homePlanetId: planetId,
      moonAvailable: true,
      ...(moon ? {} : { unavailableReason: "No moon exists for this home planet yet." }),
      moon: moon
        ? {
            exists: true,
            planetId: moon.planetId,
            owner: moon.owner,
            fields: moon.fields,
            diameterKm: moon.diameterKm,
            createdAt: moon.createdAt,
            jumpGateReadyAt: "0"
          }
        : null,
      buildings: moonBuildingRows.map((building) => ({
        ...building,
        level: planetId ? this.moonBuildingLevelAsOfNow(planetId, building.id) : 0,
        cost: zeroResources()
      })),
      queue: planetId ? this.moonQueue(planetId) : null
    };
  }

  riftState(wallet: `0x${string}`, planetId: string | null): RiftState {
    const buildings = planetId ? this.infrastructureRows(planetId) : [];
    const levels = this.technologyLevels(wallet);
    const riftBuilt = planetId
      ? (buildings.find((building) => building.id === 15)?.level ?? 0) > 0
      : null;
    const balances = this.riftBalances(wallet, planetId);
    const balanceById = new Map(balances.map((row) => [row.resource_id, row]));
    const pending = this.pendingWithdrawals(wallet, planetId);
    return {
      wallet,
      homePlanetId: planetId,
      riftAvailable: riftBuilt !== null,
      unlocked: riftBuilt === true,
      ...(riftBuilt ? {} : {
        unavailableReason: riftBuilt === null
          ? "Settle a home planet before using the Rift."
          : "Build the Rift Stabilizer before using the Rift."
      }),
      withdrawalDelaySeconds: "2592000",
      requirements: riftRequirements(
        riftBuilt,
        buildings.find((building) => building.id === 4)?.level ?? 0,
        buildings.find((building) => building.id === 6)?.level ?? 0,
        levels
      ),
      resources: riftResourceRows.map((resource) => {
        const balance = balanceById.get(resource.resourceId);
        return {
          ...resource,
          tokenAddress: null,
          walletBalance: null,
          allowance: null,
          inGameBalance: balance?.in_game_balance ?? "0",
          lockedBalance: balance?.locked_balance ?? "0"
        };
      }),
      pendingWithdrawals: pending.map((row) => ({
        id: row.withdrawal_key,
        resource: riftResourceRows.find((resource) => resource.resourceId === row.resource_id)?.key ?? "metal",
        amount: row.amount,
        requestedAt: "0",
        unlocksAt: row.unlocks_at,
        ready: BigInt(row.unlocks_at) <= BigInt(Math.floor(Date.now() / 1000))
      }))
    };
  }

  applyEvent(event: SettledPlanetEvent): IndexerSnapshot {
    this.upsertPlanet(event);
    this.touch();
    return this.snapshot();
  }

  applyPlanetSettledEvent(event: PlanetSettledEvent): IndexerSnapshot {
    this.updatePlanetResources(event);
    this.touch();
    return this.snapshot();
  }

  applyDebrisEvent(event: DebrisFieldEvent): IndexerSnapshot {
    this.upsertDebris(event);
    this.touch();
    return this.snapshot();
  }

  applyMoonChanceEvent(event: MoonChanceReportEvent): IndexerSnapshot {
    this.upsertMoonChanceReport(event);
    this.touch();
    return this.snapshot();
  }

  // Recording the log, advancing the indexed head, and applying the event's side effects must commit as
  // ONE atomic unit. Each was previously a separate auto-committed statement, so a handler that threw mid
  // way (e.g. a decode failure) left the event row already inserted — which reads as a permanent duplicate
  // on retry, so the side effect was lost forever — and left `latestIndexedBlock` advanced past an event
  // whose state never applied. That ahead-of-state head then froze the reconcile baseline above
  // already-returned fleets, hiding their ships from the shipyard. Wrapping the body in a transaction
  // means a throw rolls back the row and the head together, so the sync layer can re-apply the log cleanly.
  applyLog(log: IndexedRpcLog): ApplyLogResult {
    return this.db.transaction(() => this.applyLogAtomic(log))();
  }

  private applyLogAtomic(log: IndexedRpcLog): ApplyLogResult {
    const eventId = indexedLogKey(log);
    const existing = this.db.query("SELECT event_json FROM indexed_event_logs WHERE event_id = ?").get(eventId) as EventRow | null;
    if (existing) {
      if (log.removed) {
        this.markReorgDetected();
        this.recordRemovedLog(`${eventId}:removed`, log);
        return { applied: false, duplicate: false, ignored: false, removed: true, snapshot: this.snapshot() };
      }
      return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    const inserted = this.recordLog(eventId, log);
    if (!inserted) {
      return { applied: false, duplicate: true, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    this.recordLatestBlock(log.blockNumber);

    if (log.removed) {
      this.markReorgDetected();
      this.markStale("removed log/reorg");
      return { applied: false, duplicate: false, ignored: false, removed: true, snapshot: this.snapshot() };
    }

    this.recordPlayerActivityFromLog(eventId, log);

    if (isSettledPlanetLog(log)) {
      this.applyEvent(decodeSettledPlanetLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isPlanetSettledLog(log)) {
      this.applyPlanetSettledEvent(decodePlanetSettledLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isPlanetRenamedLog(log)) {
      this.applyPlanetRenamedEvent(decodePlanetRenamedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isDebrisFieldLog(log)) {
      this.applyDebrisEvent(decodeDebrisFieldLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isShipCountChangedLog(log)) {
      this.applyShipCountChangedEvent(decodeShipCountChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isDefenseCountChangedLog(log)) {
      this.applyDefenseCountChangedEvent(decodeDefenseCountChangedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isIndexedQueueStartedLog(log)) {
      this.applyQueueStartedEvent(decodeIndexedQueueStartedLog(log), {
        settledAt: blockTimestampSeconds(log) ?? Math.floor(Date.now() / 1_000).toString()
      });
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isIndexedQueueCompletedLog(log)) {
      this.applyQueueCompletedEvent(decodeIndexedQueueCompletedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonCreatedLog(log)) {
      this.applyMoonCreatedEvent(decodeMoonCreatedLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isRiftResourceLog(log)) {
      this.applyRiftResourceEvent(decodeRiftResourceLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isAllianceLog(log)) {
      this.applyAllianceEvent(decodeAllianceLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isFleetMissionLog(log)) {
      // Fleet-mission state is decoded from the event log on read. Combat ship/defense thinning that the
      // mission settlement applies is reported separately by PlanetShipCountChanged /
      // PlanetDefenseCountChanged events (integrated above), so no runtime RPC re-read is needed: the
      // combat-triggered per-planet canonical reconcile has been removed (canonical-mirror contract).
      this.touch();
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonChanceReportLog(log)) {
      this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isRandomnessFulfilledLog(log)) {
      // VEY-KANEO-479: the log is already persisted in indexed_event_logs above; fleet-mission readiness
      // derives the fulfilled-request set from it on read (fulfilledRandomnessRequestIds). Mark it
      // applied — and touch the index — so an arrived Attack flips to "Ready to resolve" on this event.
      this.touch();
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    return { applied: false, duplicate: false, ignored: true, removed: false, snapshot: this.snapshot() };
  }

  async rebuild(options: { deadlineMs?: number } = {}): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }

    const deadlineMs = options.deadlineMs ?? this.rebuildDeadlineMs;
    this.rebuildPromise = this.rebuildUncached(deadlineMs)
      .catch((error) => {
        this.recordReconciliationError(error);
        throw error;
      })
      .finally(() => {
        this.rebuildPromise = null;
        this.planetRebuildPromise = null;
      });
    this.planetRebuildPromise = this.rebuildPromise;
    return this.rebuildPromise;
  }

  async reconcile(reason = "requested"): Promise<IndexerSnapshot> {
    this.markStale(reason);
    return this.rebuild();
  }

  // NOTE: the periodic runtime canonical refresh (refreshCanonicalState/refreshCanonicalStateUncached)
  // has been REMOVED. The normal backend mutates the DB only from event-listener/event-replay callbacks
  // (applyLog). Canonical eth_call rebuild() remains an explicit operator/test tool, not a request path
  // or automatic startup self-heal.

  markStale(reason: string): IndexerSnapshot {
    this.setMetadata("pendingReconciliationReason", reason);
    return this.snapshot();
  }

  // NOTE: the runtime per-planet RPC self-heal (verifyCanonicalState / healPlanetCanonicalState) has been
  // REMOVED. It was the request-time and combat-triggered "re-read this planet from chain and re-pin
  // contract_* to it" path. Under the canonical-mirror contract NO request or runtime event may issue an
  // RPC read: the contract_* tables are maintained by event-listener/event-replay callbacks (applyLog).
  // Drift correction is an explicit operator sync, not runtime self-heal.

  async replayContractLogs(fromBlock = this.fromBlock, toBlock: bigint | "latest" = "latest"): Promise<IndexerSnapshot> {
    if (!this.chainReader.listContractLogs) {
      throw new Error("contract log replay is unavailable: chain reader cannot list raw contract logs");
    }
    const logs = await this.chainReader.listContractLogs(fromBlock, toBlock);
    for (const log of sortRpcLogs(logs)) {
      this.applyLog(log);
    }
    this.rebuildMaterializedStateFromEventLogs();
    this.setMetadata("lastEventReplayAt", new Date().toISOString());
    if (typeof toBlock === "bigint") {
      this.recordLatestBlock(toBlock.toString());
    }
    return this.snapshot();
  }

  async syncCanonicalState(
    fromBlock = this.fromBlock,
    toBlock: bigint | "latest" = "latest",
    options: { rebuildDeadlineMs?: number } = {}
  ): Promise<{
    replay: IndexerSnapshot;
    rebuild: IndexerSnapshot;
  }> {
    const replay = await this.replayContractLogs(fromBlock, toBlock);
    const rebuild = await this.rebuild({ deadlineMs: options.rebuildDeadlineMs ?? 0 });
    return { replay, rebuild };
  }

  async rebuildPlanets(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }
    if (this.planetRebuildPromise) {
      return this.planetRebuildPromise;
    }

    this.planetRebuildPromise = this.rebuildPlanetsUncached().finally(() => {
      this.planetRebuildPromise = null;
    });
    return this.planetRebuildPromise;
  }

  // VEY-KANEO-485: the chain-read phase of a full cold rebuild — every getLogs backfill and canonical
  // read — wrapped so the deadline guards the slow, RPC-bound work. The fast synchronous DB write phase
  // runs after the inputs are in hand.
  private async readRebuildInputs() {
    const settledPlanetEvents = await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const currentPlanets = this.chainReader.listCurrentPlanets
      ? await this.chainReader.listCurrentPlanets()
      : null;
    const planetEvents = currentPlanets
      ? mergeCurrentPlanetSnapshots(settledPlanetEvents, currentPlanets)
      : settledPlanetEvents;
    const debrisEvents = await this.chainReader.listDebrisFieldEvents(this.fromBlock, "latest");
    const moonChanceEvents = await this.chainReader.listMoonChanceReportEvents(this.fromBlock, "latest");
    const canonicalState = await this.readCanonicalState(planetEvents);
    const allianceLogs = this.chainReader.listAllianceLogs
      ? await this.chainReader.listAllianceLogs(this.fromBlock, "latest")
      : [];
    const allianceDirectory = this.chainReader.listAllianceDirectoryState
      ? await this.chainReader.listAllianceDirectoryState()
      : [];
    // Seed the three eventless-migratable alliance sub-states from contract reads (canonical-mirror).
    // Invites have no per-alliance enumeration getter, so probe the known-wallet set (planet owners,
    // the same candidate set as the canonical planet/owner reads) × allianceIds. Optional methods are
    // skipped when the injected reader lacks them, falling back to event-derived rows (no crash).
    const allianceCandidateWallets = Array.from(
      new Set(planetEvents.map((planet) => planet.owner.toLowerCase() as Address))
    );
    const allianceJoinRequests = this.chainReader.listAllianceJoinRequestState
      ? await this.chainReader.listAllianceJoinRequestState()
      : null;
    const allianceInvites = this.chainReader.listAllianceInviteState
      ? await this.chainReader.listAllianceInviteState(allianceCandidateWallets)
      : null;
    const allianceDiplomacy = this.chainReader.listAllianceDiplomacyState
      ? await this.chainReader.listAllianceDiplomacyState()
      : null;
    return {
      settledPlanetEvents,
      planetEvents,
      debrisEvents,
      moonChanceEvents,
      canonicalState,
      allianceLogs,
      allianceDirectory,
      allianceJoinRequests,
      allianceInvites,
      allianceDiplomacy
    };
  }

  // VEY-KANEO-485: surface a real error if the cold rebuild's chain reads stall past the deadline,
  // instead of leaving the index stuck in reconciliation_in_progress with lastReconciliationError=null
  // forever. The abandoned reads resolve into the void (no DB write runs unless the inputs arrive in
  // time); rebuild()'s catch records the error and the boot-time recovery retries it.
  private withRebuildDeadline<T>(read: Promise<T>, deadlineMs: number): Promise<T> {
    if (!deadlineMs) return read;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`cold reindex chain read exceeded ${deadlineMs}ms deadline`));
      }, deadlineMs);
      (timer as { unref?: () => void }).unref?.();
      read.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  private async rebuildUncached(deadlineMs: number): Promise<IndexerSnapshot> {
    const {
      settledPlanetEvents,
      planetEvents,
      debrisEvents,
      moonChanceEvents,
      canonicalState,
      allianceLogs,
      allianceDirectory,
      allianceJoinRequests,
      allianceInvites,
      allianceDiplomacy
    } = await this.withRebuildDeadline(this.readRebuildInputs(), deadlineMs);
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      this.db.query("DELETE FROM indexed_debris_fields").run();
      this.db.query("DELETE FROM indexed_moon_chance_reports").run();
      this.clearCanonicalState();
      for (const event of planetEvents) {
        this.upsertPlanet(event);
      }
      this.applyCanonicalState(canonicalState);
      this.replayEventDerivedQueueStateFromEventLogs(canonicalState);
      for (const event of debrisEvents) {
        this.upsertDebris(event);
      }
      for (const event of moonChanceEvents) {
        this.upsertMoonChanceReport(event);
      }
      for (const log of allianceLogs) {
        this.recordLogIfMissing(log);
        this.applyAllianceEvent(decodeAllianceLog(log));
      }
      this.applyAllianceDirectorySnapshot(allianceDirectory);
      // Seed the three sub-states from chain reads AFTER the event replay so contract reads are
      // authoritative over (possibly incomplete) event-derived rows. A non-null-but-empty snapshot
      // means the chain has none, so the prior clearCanonicalState leaves the table empty (no stale
      // event rows survive). A null snapshot means the reader can't read it — leave event rows as-is.
      this.applyAllianceJoinRequestSnapshot(allianceJoinRequests);
      this.applyAllianceInviteSnapshot(allianceInvites);
      this.applyAllianceDiplomacySnapshot(allianceDiplomacy);
      const latestBlock = latestEventBlock([...settledPlanetEvents, ...debrisEvents, ...moonChanceEvents, ...allianceLogs]);
      this.recordSuccessfulAllianceReconciliation();
      this.touch();
      this.recordSuccessfulReconciliation(latestBlock);
    });
    rebuild();
    return this.snapshot();
  }

  private async rebuildPlanetsUncached(): Promise<IndexerSnapshot> {
    const events = this.chainReader.listCurrentPlanets
      ? await this.chainReader.listCurrentPlanets()
      : await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      this.db.query("DELETE FROM contract_players").run();
      this.db.query("DELETE FROM contract_planets").run();
      this.db.query("DELETE FROM contract_planet_resources").run();
      for (const event of events) {
        this.upsertPlanet(event);
      }
      this.touch();
    });
    rebuild();
    return this.snapshot();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexer_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_profiles (
        wallet TEXT PRIMARY KEY,
        display_name TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_player_activity (
        wallet TEXT PRIMARY KEY,
        last_active_at TEXT NOT NULL,
        event_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_planets (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        galaxy INTEGER NOT NULL,
        system INTEGER NOT NULL,
        position INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_planets_owner_idx ON indexed_planets (owner);
      CREATE INDEX IF NOT EXISTS indexed_planets_coordinates_idx ON indexed_planets (galaxy, system, position);
      CREATE TABLE IF NOT EXISTS indexed_debris_fields (
        planet_id TEXT PRIMARY KEY,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_moon_chance_reports (
        report_key TEXT PRIMARY KEY,
        target_planet_id TEXT NOT NULL,
        battle_id TEXT NOT NULL,
        outcome_id TEXT,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_moon_chance_reports_target_idx
        ON indexed_moon_chance_reports (target_planet_id);
      CREATE TABLE IF NOT EXISTS indexed_event_logs (
        event_id TEXT PRIMARY KEY,
        transaction_hash TEXT NOT NULL,
        log_index TEXT NOT NULL,
        block_number TEXT NOT NULL,
        removed INTEGER NOT NULL DEFAULT 0,
        event_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_event_logs_block_idx
        ON indexed_event_logs (block_number);
      CREATE TABLE IF NOT EXISTS indexed_planet_queues (
        queue_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        planet_id TEXT,
        owner TEXT,
        item_id INTEGER NOT NULL,
        target_level INTEGER,
        quantity INTEGER,
        ready_at TEXT NOT NULL,
        started_at TEXT,
        cost_json TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS indexed_planet_queues_planet_idx
        ON indexed_planet_queues (planet_id, kind);
      CREATE INDEX IF NOT EXISTS indexed_planet_queues_owner_idx
        ON indexed_planet_queues (owner, kind);
      CREATE TABLE IF NOT EXISTS indexed_building_levels (
        planet_id TEXT NOT NULL,
        building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, building_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_defense_counts (
        planet_id TEXT NOT NULL,
        defense_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, defense_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_ship_counts (
        planet_id TEXT NOT NULL,
        ship_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, ship_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_research_levels (
        owner TEXT NOT NULL,
        technology_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (owner, technology_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_moons (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        fields INTEGER NOT NULL,
        diameter_km INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_moon_building_levels (
        planet_id TEXT NOT NULL,
        building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, building_id)
      );

      CREATE TABLE IF NOT EXISTS contract_players (
        wallet TEXT PRIMARY KEY,
        home_planet_id TEXT,
        planet_count INTEGER NOT NULL DEFAULT 0,
        active_fleet_mission_count INTEGER NOT NULL DEFAULT 0,
        event_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_planets (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT,
        galaxy INTEGER NOT NULL,
        system_number INTEGER NOT NULL,
        position INTEGER NOT NULL,
        fields INTEGER NOT NULL,
        temperature INTEGER NOT NULL,
        metal_multiplier_bps INTEGER NOT NULL,
        crystal_multiplier_bps INTEGER NOT NULL,
        deuterium_multiplier_bps INTEGER NOT NULL,
        last_settled_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_planets_owner_idx ON contract_planets (owner);
      CREATE INDEX IF NOT EXISTS contract_planets_coordinates_idx
        ON contract_planets (galaxy, system_number, position);
      CREATE TABLE IF NOT EXISTS contract_planet_resources (
        planet_id TEXT PRIMARY KEY,
        metal TEXT NOT NULL,
        crystal TEXT NOT NULL,
        deuterium TEXT NOT NULL,
        last_settled_at TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        block_number TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_building_levels (
        planet_id TEXT NOT NULL,
        building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, building_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_rift_balances (
        owner TEXT NOT NULL,
        planet_id TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        in_game_balance TEXT NOT NULL,
        locked_balance TEXT NOT NULL,
        PRIMARY KEY (owner, planet_id, resource_id)
      );
      CREATE TABLE IF NOT EXISTS indexed_rift_withdrawals (
        withdrawal_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        planet_id TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        amount TEXT NOT NULL,
        unlocks_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_production_queues (
        queue_key TEXT PRIMARY KEY,
        queue_kind TEXT NOT NULL,
        planet_id TEXT,
        owner TEXT,
        item_id INTEGER NOT NULL,
        target_level INTEGER,
        quantity INTEGER,
        ready_at TEXT NOT NULL,
        started_at TEXT,
        metal_cost TEXT NOT NULL,
        crystal_cost TEXT NOT NULL,
        deuterium_cost TEXT NOT NULL,
        backlog_json TEXT,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_production_queues_planet_idx
        ON contract_production_queues (planet_id, queue_kind);
      CREATE INDEX IF NOT EXISTS contract_production_queues_owner_idx
        ON contract_production_queues (owner, queue_kind);
      CREATE VIEW IF NOT EXISTS contract_building_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'building';
      CREATE VIEW IF NOT EXISTS contract_defense_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'defense';
      CREATE VIEW IF NOT EXISTS contract_shipyard_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'ship';
      CREATE VIEW IF NOT EXISTS contract_research_queues AS
        SELECT * FROM contract_production_queues WHERE queue_kind = 'research';
      CREATE TABLE IF NOT EXISTS contract_technology_levels (
        owner TEXT NOT NULL,
        technology_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (owner, technology_id)
      );
      CREATE TABLE IF NOT EXISTS contract_ship_counts (
        planet_id TEXT NOT NULL,
        ship_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, ship_id)
      );
      CREATE TABLE IF NOT EXISTS contract_defense_counts (
        planet_id TEXT NOT NULL,
        defense_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (planet_id, defense_id)
      );
      CREATE TABLE IF NOT EXISTS contract_moons (
        planet_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        exists_flag INTEGER NOT NULL,
        fields INTEGER,
        diameter_km INTEGER,
        created_at TEXT,
        jump_gate_ready_at TEXT,
        event_json TEXT
      );
      CREATE TABLE IF NOT EXISTS contract_moon_building_levels (
        planet_id TEXT NOT NULL,
        moon_building_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        PRIMARY KEY (planet_id, moon_building_id)
      );
      CREATE TABLE IF NOT EXISTS contract_moon_building_queues (
        planet_id TEXT PRIMARY KEY,
        moon_building_id INTEGER NOT NULL,
        target_level INTEGER NOT NULL,
        ready_at TEXT NOT NULL,
        metal_cost TEXT NOT NULL,
        crystal_cost TEXT NOT NULL,
        deuterium_cost TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_moon_chance_reports (
        report_key TEXT PRIMARY KEY,
        target_planet_id TEXT NOT NULL,
        battle_id TEXT NOT NULL,
        outcome_id TEXT,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_moon_chance_reports_target_idx
        ON contract_moon_chance_reports (target_planet_id);
      CREATE TABLE IF NOT EXISTS contract_debris_fields (
        planet_id TEXT PRIMARY KEY,
        metal TEXT NOT NULL,
        crystal TEXT NOT NULL,
        block_number TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contract_fleet_missions (
        mission_id TEXT PRIMARY KEY,
        status_id INTEGER NOT NULL,
        mission_type_id INTEGER NOT NULL,
        owner TEXT NOT NULL,
        origin_planet_id TEXT NOT NULL,
        target_planet_id TEXT NOT NULL,
        departure_at TEXT NOT NULL,
        arrival_at TEXT NOT NULL,
        return_at TEXT NOT NULL,
        fuel_cost TEXT NOT NULL,
        metal_cargo TEXT NOT NULL,
        crystal_cargo TEXT NOT NULL,
        deuterium_cargo TEXT NOT NULL,
        ships_json TEXT NOT NULL,
        randomness_request_id TEXT,
        event_json TEXT
      );
      CREATE INDEX IF NOT EXISTS contract_fleet_missions_owner_idx
        ON contract_fleet_missions (owner, status_id);
      CREATE INDEX IF NOT EXISTS contract_fleet_missions_target_idx
        ON contract_fleet_missions (target_planet_id, status_id);
      CREATE TABLE IF NOT EXISTS contract_rift_withdrawals (
        owner TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        active INTEGER NOT NULL,
        planet_id TEXT NOT NULL,
        amount TEXT NOT NULL,
        unlocks_at TEXT NOT NULL,
        event_json TEXT,
        PRIMARY KEY (owner, resource_id)
      );
      CREATE TABLE IF NOT EXISTS contract_alliances (
        alliance_id TEXT PRIMARY KEY,
        active INTEGER NOT NULL,
        tag TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        owner TEXT NOT NULL,
        created_at TEXT NOT NULL,
        member_count INTEGER NOT NULL,
        event_json TEXT
      );
      CREATE TABLE IF NOT EXISTS contract_alliance_members (
        alliance_id TEXT NOT NULL,
        wallet TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (alliance_id, wallet)
      );
      CREATE INDEX IF NOT EXISTS contract_alliance_members_wallet_idx
        ON contract_alliance_members (wallet);
      CREATE TABLE IF NOT EXISTS contract_alliance_invites (
        alliance_id TEXT NOT NULL,
        player TEXT NOT NULL,
        inviter TEXT NOT NULL,
        invited_at TEXT NOT NULL,
        PRIMARY KEY (alliance_id, player)
      );
      CREATE INDEX IF NOT EXISTS contract_alliance_invites_player_idx
        ON contract_alliance_invites (player);
      CREATE TABLE IF NOT EXISTS contract_alliance_join_requests (
        alliance_id TEXT NOT NULL,
        requester TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        PRIMARY KEY (alliance_id, requester)
      );
      CREATE INDEX IF NOT EXISTS contract_alliance_join_requests_requester_idx
        ON contract_alliance_join_requests (requester);
      CREATE TABLE IF NOT EXISTS contract_alliance_diplomacy (
        alliance_id TEXT NOT NULL,
        other_alliance_id TEXT NOT NULL,
        status_id INTEGER NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (alliance_id, other_alliance_id)
      );
      CREATE TABLE IF NOT EXISTS contract_highscore_inputs (
        wallet TEXT PRIMARY KEY,
        home_planet_id TEXT,
        buildings_json TEXT NOT NULL DEFAULT '[]',
        defenses_json TEXT NOT NULL DEFAULT '[]',
        ships_json TEXT NOT NULL DEFAULT '[]',
        technologies_json TEXT NOT NULL DEFAULT '[]',
        moon_buildings_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("contract_production_queues", "backlog_json", "TEXT");
    this.backfillCanonicalTables();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((candidate) => candidate.name === column)) return;
    this.db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }

  private backfillCanonicalTables(): void {
    const now = new Date().toISOString();
    const planets = this.rows<SettledPlanetEvent>("SELECT event_json FROM indexed_planets ORDER BY CAST(planet_id AS INTEGER) ASC");
    for (const planet of planets) {
      this.upsertPlanet(planet);
    }

    const debrisRows = this.rows<DebrisFieldEvent>("SELECT event_json FROM indexed_debris_fields ORDER BY CAST(planet_id AS INTEGER) ASC");
    for (const debris of debrisRows) {
      this.upsertDebris(debris);
    }

    const moonReportRows = this.rows<MoonChanceReportEvent>("SELECT event_json FROM indexed_moon_chance_reports ORDER BY block_number ASC");
    for (const report of moonReportRows) {
      this.upsertMoonChanceReport(report);
    }

    // NOTE: the canonical contract_* level/count/research tables are maintained by event-listener and
    // explicit event-replay callbacks during normal operation. The previous
    // `INSERT OR IGNORE INTO contract_* SELECT ... FROM indexed_*` backfills are removed because they
    // could preserve stale/incomplete rows instead of applying the latest absolute event totals.

    const queueRows = this.db.query(`
      SELECT queue_key, kind, planet_id, owner, item_id, target_level, quantity, ready_at, started_at, cost_json, event_json
      FROM indexed_planet_queues
    `).all() as LegacyQueueRow[];
    for (const queue of queueRows) {
      const cost = parseEvent<ResourceColumns>(queue.cost_json);
      this.db.query(`
        INSERT OR IGNORE INTO contract_production_queues (
          queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity,
          ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, event_json
        )
        VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        queue.queue_key,
        queue.kind,
        queue.planet_id,
        queue.owner,
        queue.item_id,
        queue.target_level,
        queue.quantity,
        queue.ready_at,
        queue.started_at,
        cost.metal,
        cost.crystal,
        cost.deuterium,
        queue.event_json
      );
      if (queue.kind === "moon-building" && queue.planet_id && queue.target_level !== null) {
        this.db.query(`
          INSERT OR IGNORE INTO contract_moon_building_queues (
            planet_id, moon_building_id, target_level, ready_at,
            metal_cost, crystal_cost, deuterium_cost, event_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          queue.planet_id,
          queue.item_id,
          queue.target_level,
          queue.ready_at,
          cost.metal,
          cost.crystal,
          cost.deuterium,
          queue.event_json
        );
      }
    }

    this.db.query(`
      INSERT OR IGNORE INTO contract_highscore_inputs (wallet, home_planet_id, updated_at)
      SELECT wallet, home_planet_id, ?
      FROM contract_players
    `).run(now);

    this.replayMaterializedStateFromEventLogs();
  }

  private replayMaterializedStateFromEventLogs(): void {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
      ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC
    `).all() as EventRow[];

    for (const row of rows) {
      const log = parseEvent<IndexedRpcLog>(row.event_json);
      if (isIndexedQueueStartedLog(log)) {
        const event = decodeIndexedQueueStartedLog(log);
        if (!this.queueStartProvenCompleted(event)) {
          this.applyQueueStartedEvent(event, { settleResources: false });
        }
      } else if (isIndexedQueueCompletedLog(log)) {
        this.applyQueueCompletedEvent(decodeIndexedQueueCompletedLog(log));
      } else if (isShipCountChangedLog(log)) {
        this.applyShipCountChangedEvent(decodeShipCountChangedLog(log));
      } else if (isDefenseCountChangedLog(log)) {
        this.applyDefenseCountChangedEvent(decodeDefenseCountChangedLog(log));
      } else if (isAllianceLog(log)) {
        this.applyAllianceEvent(decodeAllianceLog(log));
      }
    }
  }

  private rebuildMaterializedStateFromEventLogs(): void {
    this.db.transaction(() => {
      const rows = this.db.query(`
        SELECT event_json
        FROM indexed_event_logs
        WHERE removed = 0
        ORDER BY CAST(block_number AS INTEGER) ASC
      `).all() as EventRow[];
      if (rows.length === 0) return;

      this.clearEventDerivedMaterializedState();
      const logs = rows.map((row) => parseEvent<IndexedRpcLog>(row.event_json));
      for (const log of sortRpcLogs(logs)) {
        this.applyStoredLogSideEffects(log);
      }
      this.touch();
    })();
  }

  private clearEventDerivedMaterializedState(): void {
    this.db.query("DELETE FROM indexed_planet_queues").run();
    this.db.query("DELETE FROM indexed_building_levels").run();
    this.db.query("DELETE FROM indexed_defense_counts").run();
    this.db.query("DELETE FROM indexed_ship_counts").run();
    this.db.query("DELETE FROM indexed_research_levels").run();
    this.db.query("DELETE FROM indexed_moons").run();
    this.db.query("DELETE FROM indexed_moon_building_levels").run();
    this.db.query("DELETE FROM indexed_rift_balances").run();
    this.db.query("DELETE FROM indexed_rift_withdrawals").run();
    this.db.query("DELETE FROM contract_planet_resources").run();
    this.db.query("DELETE FROM contract_debris_fields").run();
    this.db.query("DELETE FROM contract_moon_chance_reports").run();
    this.db.query("DELETE FROM contract_building_levels").run();
    this.db.query("DELETE FROM contract_defense_counts").run();
    this.db.query("DELETE FROM contract_ship_counts").run();
    this.db.query("DELETE FROM contract_technology_levels").run();
    this.db.query("DELETE FROM contract_production_queues").run();
    this.db.query("DELETE FROM contract_moon_building_queues").run();
    this.db.query("DELETE FROM contract_alliances").run();
    this.db.query("DELETE FROM contract_alliance_members").run();
    this.db.query("DELETE FROM contract_alliance_invites").run();
    this.db.query("DELETE FROM contract_alliance_join_requests").run();
    this.db.query("DELETE FROM contract_alliance_diplomacy").run();
  }

  private applyStoredLogSideEffects(log: IndexedRpcLog): void {
    if (isSettledPlanetLog(log)) {
      this.applyEvent(decodeSettledPlanetLog(log));
    } else if (isPlanetSettledLog(log)) {
      this.applyPlanetSettledEvent(decodePlanetSettledLog(log));
    } else if (isPlanetRenamedLog(log)) {
      this.applyPlanetRenamedEvent(decodePlanetRenamedLog(log));
    } else if (isDebrisFieldLog(log)) {
      this.applyDebrisEvent(decodeDebrisFieldLog(log));
    } else if (isShipCountChangedLog(log)) {
      this.applyShipCountChangedEvent(decodeShipCountChangedLog(log));
    } else if (isDefenseCountChangedLog(log)) {
      this.applyDefenseCountChangedEvent(decodeDefenseCountChangedLog(log));
    } else if (isIndexedQueueStartedLog(log)) {
      this.applyQueueStartedEvent(decodeIndexedQueueStartedLog(log), {
        settledAt: blockTimestampSeconds(log) ?? Math.floor(Date.now() / 1_000).toString()
      });
    } else if (isIndexedQueueCompletedLog(log)) {
      this.applyQueueCompletedEvent(decodeIndexedQueueCompletedLog(log));
    } else if (isMoonCreatedLog(log)) {
      this.applyMoonCreatedEvent(decodeMoonCreatedLog(log));
    } else if (isRiftResourceLog(log)) {
      this.applyRiftResourceEvent(decodeRiftResourceLog(log));
    } else if (isAllianceLog(log)) {
      this.applyAllianceEvent(decodeAllianceLog(log));
    } else if (isFleetMissionLog(log) || isMoonChanceReportLog(log) || isRandomnessFulfilledLog(log)) {
      if (isMoonChanceReportLog(log)) {
        this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
      } else {
        this.touch();
      }
    }
  }

  private replayEventDerivedQueueStateFromEventLogs(canonicalState?: CanonicalReconciliationState): void {
    const activeEventQueues = new Set<string>();
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
      ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC
    `).all() as EventRow[];

    for (const row of rows) {
      const log = parseEvent<IndexedRpcLog>(row.event_json);
      if (isIndexedQueueStartedLog(log)) {
        const event = decodeIndexedQueueStartedLog(log);
        if (this.queueStartProvenCompleted(event) || canonicalState?.verifiedEmptyQueues.has(queueKey(event))) {
          activeEventQueues.delete(queueKey(event));
          continue;
        }
        const settledAt = blockTimestampSeconds(log);
        this.applyQueueStartedEvent(event, {
          settleResources: !this.hasCanonicalResourcesForQueue(event, canonicalState),
          ...(settledAt ? { settledAt } : {})
        });
        activeEventQueues.add(queueKey(event));
      } else if (isIndexedQueueCompletedLog(log)) {
        const event = decodeIndexedQueueCompletedLog(log);
        const key = queueKey(event);
        if (activeEventQueues.has(key)) {
          this.applyQueueCompletedEvent(event);
          activeEventQueues.delete(key);
        } else {
          this.applyQueueCompletionEffects(event);
        }
      } else if (isAllianceLog(log)) {
        this.applyAllianceEvent(decodeAllianceLog(log));
      }
    }
  }

  private queueStartProvenCompleted(event: IndexedQueueStartedEvent): boolean {
    if (event.queueKind === "building" && event.planetId && event.targetLevel !== undefined) {
      return this.indexedLevel("contract_building_levels", "building_id", event.planetId, event.itemId) >= event.targetLevel;
    }
    if (event.queueKind === "moon-building" && event.planetId && event.targetLevel !== undefined) {
      return this.indexedLevel("contract_moon_building_levels", "moon_building_id", event.planetId, event.itemId) >= event.targetLevel;
    }
    if (event.queueKind === "research" && event.owner && event.targetLevel !== undefined) {
      const row = this.db.query(`
        SELECT level
        FROM contract_technology_levels
        WHERE owner = lower(?) AND technology_id = ?
      `).get(event.owner, event.itemId) as { level: number } | null;
      return (row?.level ?? 0) >= event.targetLevel;
    }

    return false;
  }

  private async readCanonicalState(planets: SettledPlanetEvent[]): Promise<CanonicalReconciliationState> {
    const state: CanonicalReconciliationState = {
      resources: new Map(),
      planetQueues: new Map(),
      buildings: new Map(),
      defenses: new Map(),
      ships: new Map(),
      research: new Map(),
      researchQueues: new Map(),
      moonBuildings: new Map(),
      moonQueues: new Map(),
      verifiedEmptyQueues: new Set()
    };
    const owners = new Set(planets.map((planet) => planet.owner.toLowerCase() as `0x${string}`));

    // Read the universe in bounded planet batches rather than one universe-wide Promise.all. Each planet
    // fans out 4 batched eth_call reads, so the unbounded version fired hundreds of large batches at once
    // — the self-hosted node truncated some responses ("Unexpected end of JSON input") and the canonical
    // reconcile failed deterministically, freezing lastReconciledBlock (VEY-KANEO-461). Chunking caps the
    // in-flight reads so the node returns each batch intact and the reconcile completes.
    for (const planetChunk of chunks(planets, CANONICAL_READ_PLANET_CHUNK)) {
      await Promise.all(planetChunk.map(async (planet) => {
      const planetId = planet.planetId;
      const owner = planet.owner as `0x${string}`;
      const [
        infrastructure,
        defenses,
        shipyard,
        queues
      ] = await Promise.all([
        this.chainReader.getInfrastructureState?.(owner, BigInt(planetId)),
        this.chainReader.getDefenseState?.(owner, BigInt(planetId)),
        this.chainReader.getShipyardState?.(owner, BigInt(planetId)),
        this.chainReader.getPlayerQueues?.(owner, BigInt(planetId))
      ]);

      if (infrastructure) {
        this.addCanonicalResources(state, planetId, infrastructure.resources);
        state.buildings.set(planetId, infrastructure.buildings);
        if (infrastructure.queue?.active) {
          state.planetQueues.set(`building:${planetId}`, infrastructure.queue);
          state.verifiedEmptyQueues.delete(`building:${planetId}`);
        } else {
          state.verifiedEmptyQueues.add(`building:${planetId}`);
        }
      }
      if (defenses) {
        this.addCanonicalResources(state, planetId, defenses.resources);
        state.defenses.set(planetId, defenses.defenses);
        if (defenses.queue?.active) {
          state.planetQueues.set(`defense:${planetId}`, defenses.queue);
          state.verifiedEmptyQueues.delete(`defense:${planetId}`);
        } else {
          state.verifiedEmptyQueues.add(`defense:${planetId}`);
        }
      }
      if (shipyard) {
        this.addCanonicalResources(state, planetId, shipyard.resources);
        state.ships.set(planetId, shipyard.ships);
        if (shipyard.queue?.active) {
          state.planetQueues.set(`ship:${planetId}`, shipyard.queue);
          state.verifiedEmptyQueues.delete(`ship:${planetId}`);
        } else {
          state.verifiedEmptyQueues.add(`ship:${planetId}`);
        }
      }
      if (queues) {
        this.addActiveQueue(state.planetQueues, `building:${planetId}`, queues.building);
        this.addActiveQueue(state.planetQueues, `defense:${planetId}`, queues.defense);
        this.addActiveQueue(state.planetQueues, `ship:${planetId}`, queues.ship);
        this.addActiveResearchQueue(state.researchQueues, owner, queues.research);
        if (queues.building?.active) state.verifiedEmptyQueues.delete(`building:${planetId}`);
        if (queues.defense?.active) state.verifiedEmptyQueues.delete(`defense:${planetId}`);
        if (queues.ship?.active) state.verifiedEmptyQueues.delete(`ship:${planetId}`);
        if (queues.research?.active) state.verifiedEmptyQueues.delete(`research:${owner.toLowerCase()}`);
      }
      }));
    }

    for (const ownerChunk of chunks([...owners], CANONICAL_READ_PLANET_CHUNK)) {
      await Promise.all(ownerChunk.map(async (owner) => {
      // Research and moon state are both wallet-keyed on chain (resolved against the wallet's home
      // planet), so read them together per owner.
      const [research, moon] = await Promise.all([
        this.chainReader.getResearchState?.(owner),
        this.chainReader.getMoonState?.(owner)
      ]);

      // Moon: getMoonState resolves the wallet's home planet's moon. Seed the canonical moon building
      // levels + active moon-building queue keyed by that home planet id. Absent / non-existent moons
      // leave no canonical rows.
      if (moon?.moon?.exists && moon.homePlanetId) {
        state.moonBuildings.set(moon.homePlanetId, moon.buildings);
        if (moon.queue?.active) {
          state.moonQueues.set(moon.homePlanetId, moon.queue);
        }
      }

      if (!research) return;
      if (research.homePlanetId) {
        this.addCanonicalResources(state, research.homePlanetId, research.resources);
      }
      state.research.set(owner, research.technologies);
      if (research.queue?.active) {
        this.addActiveResearchQueue(state.researchQueues, owner, research.queue);
        state.verifiedEmptyQueues.delete(`research:${owner.toLowerCase()}`);
      } else {
        state.verifiedEmptyQueues.add(`research:${owner.toLowerCase()}`);
      }
      }));
    }

    return state;
  }

  private clearCanonicalState(): void {
    this.db.query("DELETE FROM indexed_planet_queues").run();
    this.db.query("DELETE FROM indexed_building_levels").run();
    this.db.query("DELETE FROM indexed_defense_counts").run();
    this.db.query("DELETE FROM indexed_ship_counts").run();
    this.db.query("DELETE FROM indexed_research_levels").run();
    this.db.query("DELETE FROM indexed_moon_building_levels").run();
    this.db.query("DELETE FROM contract_moon_building_levels").run();
    this.db.query("DELETE FROM contract_players").run();
    this.db.query("DELETE FROM contract_planets").run();
    this.db.query("DELETE FROM contract_planet_resources").run();
    this.db.query("DELETE FROM contract_debris_fields").run();
    this.db.query("DELETE FROM contract_moon_chance_reports").run();
    this.db.query("DELETE FROM contract_building_levels").run();
    this.db.query("DELETE FROM contract_defense_counts").run();
    this.db.query("DELETE FROM contract_ship_counts").run();
    this.db.query("DELETE FROM contract_technology_levels").run();
    this.db.query("DELETE FROM contract_production_queues").run();
    this.db.query("DELETE FROM contract_moon_building_queues").run();
    this.db.query("DELETE FROM contract_alliances").run();
    this.db.query("DELETE FROM contract_alliance_members").run();
    this.db.query("DELETE FROM contract_alliance_invites").run();
    this.db.query("DELETE FROM contract_alliance_join_requests").run();
    this.db.query("DELETE FROM contract_alliance_diplomacy").run();
  }

  private applyCanonicalState(state: CanonicalReconciliationState): void {
    const reconciledAt = Math.floor(Date.now() / 1_000).toString();
    const blockNumber = this.metadata("lastReconciledBlock") ?? "0";
    for (const [planetId, resources] of state.resources) {
      // Reconcile reads the freshest on-chain balance, so it is authoritative even though it is stamped
      // with lastReconciledBlock rather than a real event block — force past the monotonic guard.
      this.upsertPlanetResourceSnapshot(planetId, resources, reconciledAt, "0x", blockNumber, true);
    }
    for (const [planetId, buildings] of state.buildings) {
      for (const building of buildings) {
        this.upsertIndexedLevel("indexed_building_levels", "building_id", "level", planetId, building.id, building.level);
        this.upsertIndexedLevel("contract_building_levels", "building_id", "level", planetId, building.id, building.level);
      }
    }
    for (const [planetId, defenses] of state.defenses) {
      for (const defense of defenses) {
        this.upsertIndexedLevel("indexed_defense_counts", "defense_id", "count", planetId, defense.id, defense.count);
        this.upsertIndexedLevel("contract_defense_counts", "defense_id", "count", planetId, defense.id, defense.count);
      }
    }
    for (const [planetId, ships] of state.ships) {
      for (const ship of ships) {
        this.upsertIndexedLevel("indexed_ship_counts", "ship_id", "count", planetId, ship.id, ship.count);
        this.upsertIndexedLevel("contract_ship_counts", "ship_id", "count", planetId, ship.id, ship.count);
      }
    }
    for (const [owner, technologies] of state.research) {
      for (const technology of technologies) {
        this.db.query(`
        INSERT INTO indexed_research_levels (owner, technology_id, level)
        VALUES (lower(?), ?, ?)
        ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
      `).run(owner, technology.id, technology.level);
        this.db.query(`
          INSERT INTO contract_technology_levels (owner, technology_id, level)
          VALUES (lower(?), ?, ?)
          ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
        `).run(owner, technology.id, technology.level);
      }
    }
    for (const [planetId, buildings] of state.moonBuildings) {
      for (const building of buildings) {
        // indexed_moon_building_levels keys on building_id; contract_moon_building_levels on moon_building_id.
        this.upsertIndexedLevel("indexed_moon_building_levels", "building_id", "level", planetId, building.id, building.level);
        this.upsertIndexedLevel("contract_moon_building_levels", "moon_building_id", "level", planetId, building.id, building.level);
      }
    }
    for (const [key, queue] of state.planetQueues) {
      const [kind, planetId] = key.split(":");
      if (!kind || !planetId || !isPlanetQueueKind(kind)) continue;
      this.upsertCanonicalQueue(kind, planetId, null, queue);
    }
    for (const [owner, queue] of state.researchQueues) {
      this.upsertCanonicalQueue("research", null, owner, queue);
    }
    for (const [planetId, queue] of state.moonQueues) {
      this.upsertCanonicalMoonQueue(planetId, queue);
    }
  }

  private upsertCanonicalMoonQueue(planetId: string, queue: QueueState): void {
    if (queue.itemId === undefined || queue.targetLevel === undefined) return;
    this.upsertQueue({
      eventName: "MoonBuildingStarted",
      transactionHash: "0x",
      blockNumber: this.metadata("lastReconciledBlock") ?? "0",
      queueKind: "moon-building",
      planetId,
      itemId: queue.itemId,
      targetLevel: queue.targetLevel,
      readyAt: queue.readyAt ?? "0",
      ...(queue.startedAt ? { startedAt: queue.startedAt } : {}),
      cost: queue.cost
    });
  }

  private addActiveQueue(queues: Map<string, QueueState>, key: string, queue: QueueState | null | undefined): void {
    if (queue?.active) {
      queues.set(key, queue);
    }
  }

  private addActiveResearchQueue(queues: Map<`0x${string}`, QueueState>, owner: `0x${string}`, queue: QueueState | null | undefined): void {
    if (queue?.active) {
      queues.set(owner, queue);
    }
  }

  private addCanonicalResources(state: CanonicalReconciliationState, planetId: string, resources: Resources | null | undefined): void {
    if (resources && !state.resources.has(planetId)) {
      state.resources.set(planetId, resources);
    }
  }

  private hasCanonicalResourcesForQueue(event: IndexedQueueStartedEvent, state?: CanonicalReconciliationState): boolean {
    if (!state) return false;
    if (event.planetId) return state.resources.has(event.planetId);
    if (event.queueKind !== "research" || !event.owner) return false;

    const settlement = this.walletSettlement(event.owner);
    return Boolean(settlement.homePlanetId && state.resources.has(settlement.homePlanetId));
  }

  private upsertCanonicalQueue(
    kind: "building" | "defense" | "ship" | "research",
    planetId: string | null,
    owner: `0x${string}` | null,
    queue: QueueState
  ): void {
    this.upsertQueue({
      eventName: kind === "building" ? "BuildingStarted" : kind === "defense" ? "DefenseQueued" : kind === "ship" ? "ShipQueued" : "ResearchQueued",
      transactionHash: "0x",
      blockNumber: this.metadata("lastReconciledBlock") ?? "0",
      queueKind: kind,
      ...(planetId ? { planetId } : {}),
      ...(owner ? { owner } : {}),
      itemId: queue.itemId ?? 0,
      ...(queue.targetLevel !== undefined ? { targetLevel: queue.targetLevel } : {}),
      ...(queue.quantity !== undefined ? { quantity: queue.quantity } : {}),
      readyAt: queue.readyAt ?? "0",
      ...(queue.startedAt ? { startedAt: queue.startedAt } : {}),
      cost: queue.cost,
      ...(queue.backlog?.length ? { backlog: queue.backlog } : {})
    });
  }

  private upsertPlanet(event: SettledPlanetEvent): void {
    const planetEvent = this.withKnownPlanetResources(event);
    const placeholderResources = isZeroResourcePlaceholder(planetEvent);
    this.db.query(`
      INSERT INTO indexed_planets (planet_id, owner, galaxy, system, position, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        galaxy = excluded.galaxy,
        system = excluded.system,
        position = excluded.position,
        event_json = excluded.event_json
    `).run(
      planetEvent.planetId,
      planetEvent.owner.toLowerCase(),
      planetEvent.galaxy,
      planetEvent.system,
      planetEvent.position,
      JSON.stringify(planetEvent)
    );
    this.db.query(`
      INSERT INTO contract_players (wallet, home_planet_id, planet_count, event_json, updated_at)
      VALUES (lower(?), ?, 1, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        home_planet_id = COALESCE(contract_players.home_planet_id, excluded.home_planet_id),
        planet_count = (
          SELECT COUNT(*)
          FROM contract_planets
          WHERE owner = lower(?)
        ) + CASE
          WHEN EXISTS (SELECT 1 FROM contract_planets WHERE planet_id = ?) THEN 0
          ELSE 1
        END,
        event_json = excluded.event_json,
        updated_at = excluded.updated_at
    `).run(
      planetEvent.owner,
      planetEvent.planetId,
      JSON.stringify(planetEvent),
      new Date().toISOString(),
      planetEvent.owner,
      planetEvent.planetId
    );
    this.db.query(`
      INSERT INTO contract_planets (
        planet_id, owner, name, galaxy, system_number, position, fields, temperature,
        metal_multiplier_bps, crystal_multiplier_bps, deuterium_multiplier_bps,
        last_settled_at, event_json
      )
      VALUES (?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        name = excluded.name,
        galaxy = excluded.galaxy,
        system_number = excluded.system_number,
        position = excluded.position,
        fields = excluded.fields,
        temperature = excluded.temperature,
        metal_multiplier_bps = excluded.metal_multiplier_bps,
        crystal_multiplier_bps = excluded.crystal_multiplier_bps,
        deuterium_multiplier_bps = excluded.deuterium_multiplier_bps,
        last_settled_at = excluded.last_settled_at,
        event_json = excluded.event_json
    `).run(
      planetEvent.planetId,
      planetEvent.owner,
      planetEvent.name,
      planetEvent.galaxy,
      planetEvent.system,
      planetEvent.position,
      planetEvent.fields,
      planetEvent.temperature,
      planetEvent.metalMultiplierBps,
      planetEvent.crystalMultiplierBps,
      planetEvent.deuteriumMultiplierBps,
      planetEvent.lastSettledAt,
      JSON.stringify(planetEvent)
    );
    if (placeholderResources) {
      this.markStale(pendingPlanetResourcesReason(planetEvent.planetId));
      return;
    }

    this.upsertPlanetResourceSnapshot(
      planetEvent.planetId,
      planetEvent.resources,
      planetEvent.lastSettledAt,
      planetEvent.transactionHash,
      planetEvent.blockNumber
    );
    this.clearPlanetResourcePendingIfResolved();
  }

  private updatePlanetResources(event: PlanetSettledEvent): void {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(event.planetId) as EventRow | null;
    if (!row) {
      this.upsertPlanetResourceSnapshot(event.planetId, event.resources, event.lastSettledAt, event.transactionHash, event.blockNumber);
      this.markStale(`planet_identity_pending:${event.planetId}`);
      return;
    }

    const planet = parseEvent<SettledPlanetEvent>(row.event_json);
    this.upsertPlanet({
      ...planet,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      lastSettledAt: event.lastSettledAt,
      resources: event.resources
    });
  }

  private withKnownPlanetResources(event: SettledPlanetEvent): SettledPlanetEvent {
    if (!isZeroResourcePlaceholder(event)) return event;

    const resources = this.planetResourceSnapshot(event.planetId);
    if (!resources) return event;

    return {
      ...event,
      blockNumber: resources.block_number,
      lastSettledAt: resources.last_settled_at,
      resources: {
        metal: resources.metal,
        crystal: resources.crystal,
        deuterium: resources.deuterium
      },
      transactionHash: resources.transaction_hash
    };
  }

  private withResourceSnapshot(planet: SettledPlanetEvent): SettledPlanetEvent {
    const resources = this.planetResourceSnapshot(planet.planetId);
    return resources ? {
      ...planet,
      blockNumber: resources.block_number,
      lastSettledAt: resources.last_settled_at,
      resources: {
        metal: resources.metal,
        crystal: resources.crystal,
        deuterium: resources.deuterium
      },
      transactionHash: resources.transaction_hash
    } : planet;
  }

  private planetResourceSnapshot(planetId: string): PlanetResourceRow | null {
    return this.db.query(`
      SELECT metal, crystal, deuterium, last_settled_at, transaction_hash, block_number
      FROM contract_planet_resources
      WHERE planet_id = ?
    `).get(planetId) as PlanetResourceRow | null;
  }

  // Resource snapshots must be monotonic by block, mirroring the `latestIndexedBlock` head clamp
  // (recordLatestBlock). PlanetSettled carries the authoritative post-mutation balance, including the
  // DECREASING balance a raid or spend produces. Logs do not always reach us in block order — a gap/
  // self-heal backfill or reconcile re-applies a previously-missed OLDER range after the live head feed
  // has already advanced. An unconditional write let that stale, higher pre-mutation balance clobber the
  // newer, lower one, so the read model over-reported resources; the frontend then let the player queue
  // an upgrade they could not afford on-chain and the transaction reverted (VEY-KANEO-491). Skip any
  // event-driven write whose block is strictly older than the stored snapshot. `force` is reserved for
  // the full-reconcile canonical path (applyCanonicalState), which reads the freshest on-chain state and
  // is authoritative regardless of the block label it is stamped with.
  private upsertPlanetResourceSnapshot(
    planetId: string,
    resources: ResourceColumns,
    lastSettledAt: string,
    transactionHash: string,
    blockNumber: string,
    force = false
  ): void {
    if (!force) {
      const existing = this.db
        .query("SELECT block_number FROM contract_planet_resources WHERE planet_id = ?")
        .get(planetId) as Pick<PlanetResourceRow, "block_number"> | null;
      if (existing) {
        try {
          if (BigInt(blockNumber) < BigInt(existing.block_number)) return;
        } catch {
          // If either block label isn't a parseable integer (e.g. the "0" seed marker meeting a malformed
          // value), fall through and let the latest write win rather than silently dropping it.
        }
      }
    }
    this.db.query(`
      INSERT INTO contract_planet_resources (
        planet_id, metal, crystal, deuterium, last_settled_at, transaction_hash, block_number
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        metal = excluded.metal,
        crystal = excluded.crystal,
        deuterium = excluded.deuterium,
        last_settled_at = excluded.last_settled_at,
        transaction_hash = excluded.transaction_hash,
        block_number = excluded.block_number
    `).run(
      planetId,
      resources.metal,
      resources.crystal,
      resources.deuterium,
      lastSettledAt,
      transactionHash,
      blockNumber
    );
  }

  private clearPlanetResourcePendingIfResolved(): void {
    const pending = this.metadata("pendingReconciliationReason");
    if (!pending?.startsWith("planet_resources_pending:") && !pending?.startsWith("planet_identity_pending:")) return;
    const planetsMissingResources = this.settledPlanets().some((planet) => (
      isZeroResourcePlaceholder(planet) && !this.planetResourceSnapshot(planet.planetId)
    ));
    if (!planetsMissingResources) {
      this.db.query("DELETE FROM indexer_metadata WHERE key = 'pendingReconciliationReason'").run();
    }
  }

  private applyPlanetRenamedEvent(event: PlanetRenamedEvent): void {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(event.planetId) as EventRow | null;
    if (!row) {
      this.markStale("planet rename for unknown planet");
      return;
    }

    const planet = parseEvent<SettledPlanetEvent>(row.event_json);
    this.upsertPlanet({
      ...planet,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      owner: event.owner,
      name: event.name.length > 0 ? event.name : null
    });
    this.touch();
  }

  private upsertDebris(event: DebrisFieldEvent): void {
    if (event.resources.metal === "0" && event.resources.crystal === "0") {
      this.db.query("DELETE FROM indexed_debris_fields WHERE planet_id = ?").run(event.planetId);
      this.db.query("DELETE FROM contract_debris_fields WHERE planet_id = ?").run(event.planetId);
      return;
    }

    this.db.query(`
      INSERT INTO indexed_debris_fields (planet_id, block_number, event_json)
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(event.planetId, event.blockNumber, JSON.stringify(event));
    this.db.query(`
      INSERT INTO contract_debris_fields (planet_id, metal, crystal, block_number, event_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        metal = excluded.metal,
        crystal = excluded.crystal,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(event.planetId, event.resources.metal, event.resources.crystal, event.blockNumber, JSON.stringify(event));
  }

  private upsertMoonChanceReport(event: MoonChanceReportEvent): void {
    this.db.query(`
      INSERT INTO indexed_moon_chance_reports (report_key, target_planet_id, battle_id, outcome_id, block_number, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_key) DO UPDATE SET
        target_planet_id = excluded.target_planet_id,
        battle_id = excluded.battle_id,
        outcome_id = excluded.outcome_id,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(
      moonChanceReportKey(event),
      event.targetPlanetId,
      event.battleId,
      event.outcomeId ?? null,
      event.blockNumber,
      JSON.stringify(event)
    );
    this.db.query(`
      INSERT INTO contract_moon_chance_reports (report_key, target_planet_id, battle_id, outcome_id, block_number, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_key) DO UPDATE SET
        target_planet_id = excluded.target_planet_id,
        battle_id = excluded.battle_id,
        outcome_id = excluded.outcome_id,
        block_number = excluded.block_number,
        event_json = excluded.event_json
    `).run(
      moonChanceReportKey(event),
      event.targetPlanetId,
      event.battleId,
      event.outcomeId ?? null,
      event.blockNumber,
      JSON.stringify(event)
    );
  }

  private applyQueueStartedEvent(
    event: IndexedQueueStartedEvent,
    options: { settleResources?: boolean; settledAt?: string } = {}
  ): void {
    // Pin the queue's start time to the same instant the spend is settled against
    // the planet. The decoded log carries it when the RPC node returns block
    // timestamps; when it does not (the live-ingestion fallback synthesises a
    // settle time) reuse that settle time so `startedAt` and the planet's
    // `lastSettledAt` agree. A snapshot at/after that time is then recognised as
    // already reflecting the cost, preventing the displayed balance from being
    // double-reduced while the build is queued (VEY-318).
    const startedAt = event.startedAt ?? options.settledAt;
    const startedEvent = startedAt ? { ...event, startedAt } : event;
    this.upsertQueue(startedEvent);
    if (options.settleResources !== false) {
      if (event.planetId) {
        this.subtractPlanetResources(event.planetId, event.cost, event.transactionHash, event.blockNumber, options.settledAt);
      } else if (event.queueKind === "research" && event.owner) {
        const settlement = this.walletSettlement(event.owner);
        if (settlement.homePlanetId) {
          this.subtractPlanetResources(settlement.homePlanetId, event.cost, event.transactionHash, event.blockNumber, options.settledAt);
        }
      }
    }
    this.touch();
  }

  private applyShipCountChangedEvent(event: IndexedShipCountChangedEvent): void {
    this.upsertIndexedLevel(
      "indexed_ship_counts",
      "ship_id",
      "count",
      event.planetId,
      event.shipId,
      event.total
    );
    this.upsertIndexedLevel(
      "contract_ship_counts",
      "ship_id",
      "count",
      event.planetId,
      event.shipId,
      event.total
    );
    this.touch();
  }

  // The contract emits PlanetDefenseCountChanged with the planet's resulting defense total on every
  // defense mutation the production queue doesn't already cover — combat defense losses, post-combat
  // repair, and interplanetary-missile silo/interception/primary hits (VEY-KANEO-462). Indexing it keeps
  // contract_defense_counts authoritative from events alone, so defense counts no longer depend on a
  // canonical reconcile completing (VEY-KANEO-461).
  private applyDefenseCountChangedEvent(event: IndexedDefenseCountChangedEvent): void {
    this.upsertIndexedLevel(
      "indexed_defense_counts",
      "defense_id",
      "count",
      event.planetId,
      event.defenseId,
      event.total
    );
    this.upsertIndexedLevel(
      "contract_defense_counts",
      "defense_id",
      "count",
      event.planetId,
      event.defenseId,
      event.total
    );
    this.touch();
  }

  private applyQueueCompletedEvent(event: IndexedQueueCompletedEvent): void {
    // A building completion raises the planet's production rate. The contract
    // settles [lastSettledAt, readyAt] at the OLD rate, completes the building,
    // then accrues at the NEW rate from readyAt (VeydriftGame.sol:720-730). The
    // read-model projects from the stored baseline at the current rate, so the
    // baseline must absorb the pre-completion window at the old rate before the
    // level is bumped — otherwise the projection applies the new, higher rate
    // over the whole window since the last settle and over-reports resources by
    // up to ~3x (VEY-KANEO-429). Settle BEFORE deleting the queue (it carries
    // readyAt) and BEFORE applying the completed level.
    if (event.queueKind === "building" && event.planetId) {
      const queue = this.queueState(queueKey(event));
      this.settlePlanetResourcesUntil(event.planetId, queue?.readyAt ?? undefined);
    }
    this.db.query("DELETE FROM indexed_planet_queues WHERE queue_key = ?").run(queueKey(event));
    this.db.query("DELETE FROM contract_production_queues WHERE queue_key = ?").run(queueKey(event));
    this.applyQueueCompletionEffects(event);
    this.touch();
  }

  // Advance a planet's stored resources/lastSettledAt up to `settledAt` at the
  // current production rate, mirroring the contract's `_settleResourcesUntil`.
  // Used when a building completes so the baseline reflects accrual at the
  // pre-completion rate before the new level is applied.
  private settlePlanetResourcesUntil(planetId: string, settledAt: string | undefined): void {
    if (!settledAt) return;
    const planet = this.planet(planetId);
    if (!planet) return;
    if (isZeroResourcePlaceholder(planet) && !this.planetResourceSnapshot(planetId)) return;
    const previousSettledAt = Number(planet.lastSettledAt);
    const nextSettledAt = Number(settledAt);
    if (!Number.isFinite(previousSettledAt) || !Number.isFinite(nextSettledAt) || nextSettledAt <= previousSettledAt) {
      return;
    }
    this.upsertPlanet({
      ...planet,
      lastSettledAt: settledAt,
      resources: this.settlePlanetResourcesForSpend(planet, settledAt)
    });
  }

  private applyQueueCompletionEffects(event: IndexedQueueCompletedEvent): void {
    if (event.queueKind === "building" && event.planetId && event.level !== undefined) {
      this.upsertIndexedLevelAtLeast("indexed_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
      this.upsertIndexedLevelAtLeast("contract_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
    } else if (event.queueKind === "moon-building" && event.planetId && event.level !== undefined) {
      this.db.query("DELETE FROM contract_moon_building_queues WHERE planet_id = ?").run(event.planetId);
      this.upsertIndexedLevelAtLeast("indexed_moon_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
      this.upsertIndexedLevelAtLeast("contract_moon_building_levels", "moon_building_id", "level", event.planetId, event.itemId, event.level);
    } else if (event.queueKind === "defense" && event.planetId && event.total !== undefined) {
      this.upsertIndexedLevel("indexed_defense_counts", "defense_id", "count", event.planetId, event.itemId, event.total);
      this.upsertIndexedLevel("contract_defense_counts", "defense_id", "count", event.planetId, event.itemId, event.total);
    } else if (event.queueKind === "ship" && event.planetId && event.total !== undefined) {
      this.upsertIndexedLevel("indexed_ship_counts", "ship_id", "count", event.planetId, event.itemId, event.total);
      this.upsertIndexedLevel("contract_ship_counts", "ship_id", "count", event.planetId, event.itemId, event.total);
    } else if (event.queueKind === "research" && event.owner && event.level !== undefined) {
      this.db.query(`
        INSERT INTO indexed_research_levels (owner, technology_id, level)
        VALUES (lower(?), ?, ?)
        ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
      `).run(event.owner, event.itemId, event.level);
      this.db.query(`
        INSERT INTO contract_technology_levels (owner, technology_id, level)
        VALUES (lower(?), ?, ?)
        ON CONFLICT(owner, technology_id) DO UPDATE SET level = excluded.level
      `).run(event.owner, event.itemId, event.level);
    }
  }

  private upsertQueue(event: QueueUpsertEvent): void {
    if (this.appendProductionBacklogQueue(event)) {
      return;
    }

    const backlogJson = event.backlog?.length
      ? JSON.stringify(event.backlog)
      : this.existingBacklogJsonForSameItem(event);

    this.db.query(`
      INSERT INTO indexed_planet_queues (
        queue_key, kind, planet_id, owner, item_id, target_level, quantity, ready_at, started_at, cost_json, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(queue_key) DO UPDATE SET
        kind = excluded.kind,
        planet_id = excluded.planet_id,
        owner = excluded.owner,
        item_id = excluded.item_id,
        target_level = excluded.target_level,
        quantity = excluded.quantity,
        ready_at = excluded.ready_at,
        started_at = excluded.started_at,
        cost_json = excluded.cost_json,
        event_json = excluded.event_json
    `).run(
      queueKey(event),
      event.queueKind,
      event.planetId ?? null,
      event.owner ?? null,
      event.itemId,
      event.targetLevel ?? null,
      event.quantity ?? null,
      event.readyAt,
      event.startedAt ?? null,
      JSON.stringify(event.cost),
      JSON.stringify(event)
    );
    this.db.query(`
      INSERT INTO contract_production_queues (
        queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity,
        ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(queue_key) DO UPDATE SET
        queue_kind = excluded.queue_kind,
        planet_id = excluded.planet_id,
        owner = excluded.owner,
        item_id = excluded.item_id,
        target_level = excluded.target_level,
        quantity = excluded.quantity,
        ready_at = excluded.ready_at,
        started_at = excluded.started_at,
        metal_cost = excluded.metal_cost,
        crystal_cost = excluded.crystal_cost,
        deuterium_cost = excluded.deuterium_cost,
        backlog_json = excluded.backlog_json,
        event_json = excluded.event_json
    `).run(
      queueKey(event),
      event.queueKind,
      event.planetId ?? null,
      event.owner ?? null,
      event.itemId,
      event.targetLevel ?? null,
      event.quantity ?? null,
      event.readyAt,
      event.startedAt ?? null,
      event.cost.metal,
      event.cost.crystal,
      event.cost.deuterium,
      backlogJson,
      JSON.stringify(event)
    );

    if (event.queueKind === "moon-building" && event.planetId && event.targetLevel !== undefined) {
      this.db.query(`
        INSERT INTO contract_moon_building_queues (
          planet_id, moon_building_id, target_level, ready_at,
          metal_cost, crystal_cost, deuterium_cost, event_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(planet_id) DO UPDATE SET
          moon_building_id = excluded.moon_building_id,
          target_level = excluded.target_level,
          ready_at = excluded.ready_at,
          metal_cost = excluded.metal_cost,
          crystal_cost = excluded.crystal_cost,
          deuterium_cost = excluded.deuterium_cost,
          event_json = excluded.event_json
      `).run(
        event.planetId,
        event.itemId,
        event.targetLevel,
        event.readyAt,
        event.cost.metal,
        event.cost.crystal,
        event.cost.deuterium,
        JSON.stringify(event)
      );
    }
  }

  private appendProductionBacklogQueue(event: QueueUpsertEvent): boolean {
    if ((event.queueKind !== "defense" && event.queueKind !== "ship") || !event.planetId) {
      return false;
    }

    const row = this.db.query(`
      SELECT item_id, backlog_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKey(event)) as Pick<QueueRow, "item_id" | "backlog_json"> | null;
    if (!row || row.item_id === event.itemId) {
      return false;
    }

    const backlog = row.backlog_json ? parseEvent<QueueState[]>(row.backlog_json) : [];
    const nextBacklog = Array.isArray(backlog) ? backlog : [];
    nextBacklog.push(queueStateFromEvent(event));
    this.db.query(`
      UPDATE contract_production_queues
      SET backlog_json = ?
      WHERE queue_key = ?
    `).run(JSON.stringify(nextBacklog), queueKey(event));
    return true;
  }

  private existingBacklogJsonForSameItem(event: QueueUpsertEvent): string | null {
    if ((event.queueKind !== "defense" && event.queueKind !== "ship") || !event.planetId) {
      return null;
    }

    const row = this.db.query(`
      SELECT item_id, backlog_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKey(event)) as Pick<QueueRow, "item_id" | "backlog_json"> | null;

    return row?.item_id === event.itemId ? row.backlog_json : null;
  }

  private subtractPlanetResources(
    planetId: string,
    cost: IndexedQueueStartedEvent["cost"],
    transactionHash: string,
    blockNumber: string,
    settledAt?: string
  ): void {
    const planet = this.planet(planetId);
    if (!planet) return;

    const snapshot = this.planetResourceSnapshot(planetId);

    if (isZeroResourcePlaceholder(planet) && !snapshot) {
      this.markStale(pendingPlanetResourcesReason(planetId));
      return;
    }

    // Double-subtract guard (VEY-318 / PROBLEM B): a build/research/ship cost must be debited from the
    // planet's balance EXACTLY ONCE. The contract debits resources atomically when an item is queued and
    // emits a PlanetSettled carrying the resulting post-spend balance in the SAME transaction as the
    // PlanetQueueStarted. PlanetSettled is authoritative — `updatePlanetResources` writes the snapshot
    // with that event's transactionHash — so if the stored snapshot was written by a PlanetSettled in
    // this same tx, it already reflects the spend and subtracting again drives the displayed balance low.
    // Skip the subtraction in that case. Pre-migration spends (no same-tx PlanetSettled; the snapshot tx
    // differs, or is the seed marker "0x") fall through and still subtract.
    if (transactionHash && snapshot && snapshot.transaction_hash === transactionHash) {
      return;
    }

    this.upsertPlanet({
      ...planet,
      transactionHash,
      blockNumber,
      lastSettledAt: settledAt ?? planet.lastSettledAt,
      resources: subtractResources(this.settlePlanetResourcesForSpend(planet, settledAt), cost)
    });
  }

  private settlePlanetResourcesForSpend(planet: SettledPlanetEvent, settledAt: string | undefined): Resources {
    if (!settledAt) return planet.resources;

    const previousSettledAt = Number(planet.lastSettledAt);
    const nextSettledAt = Number(settledAt);
    if (!Number.isFinite(previousSettledAt) || !Number.isFinite(nextSettledAt) || nextSettledAt <= previousSettledAt) {
      return planet.resources;
    }

    const derived = deriveInfrastructureFields(
      planet,
      this.infrastructureRows(planet.planetId),
      this.shipRows(planet.planetId),
      this.technologyLevels(planet.owner)
    );
    return resourcesWithClaimableAccrual(
      planet.resources,
      derived.productionPerHour,
      derived.storageCaps,
      Math.floor(nextSettledAt - previousSettledAt)
    );
  }

  private queueState(queueKeyValue: string): QueueState | null {
    if (queueKeyValue.startsWith("moon-building:")) {
      const row = this.db.query(`
        SELECT planet_id, moon_building_id, target_level, ready_at, metal_cost, crystal_cost, deuterium_cost, event_json
        FROM contract_moon_building_queues
        WHERE planet_id = ?
      `).get(queueKeyValue.slice("moon-building:".length)) as MoonBuildingQueueRow | null;
      if (row) {
        return {
          active: true,
          kind: "moon-building",
          itemId: row.moon_building_id,
          targetLevel: row.target_level,
          readyAt: row.ready_at,
          cost: {
            metal: row.metal_cost,
            crystal: row.crystal_cost,
            deuterium: row.deuterium_cost
          }
        };
      }
    }

    const row = this.db.query(`
      SELECT queue_kind, item_id, target_level, quantity, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, backlog_json
      FROM contract_production_queues
      WHERE queue_key = ?
    `).get(queueKeyValue) as QueueRow | null;
    if (!row) return null;

    const queue: QueueState = {
      active: true,
      kind: row.queue_kind,
      itemId: row.item_id,
      readyAt: row.ready_at,
      startedAt: row.started_at,
      cost: {
        metal: row.metal_cost,
        crystal: row.crystal_cost,
        deuterium: row.deuterium_cost
      }
    };
    if (row.target_level !== null) {
      queue.targetLevel = row.target_level;
    }
    if (row.quantity !== null) {
      queue.quantity = row.quantity;
    }
    if (row.backlog_json) {
      const backlog = parseEvent<QueueState[]>(row.backlog_json);
      if (Array.isArray(backlog) && backlog.length > 0) {
        queue.backlog = backlog;
      }
    }
    return queue;
  }

  private indexedLevel(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_ship_counts" | "indexed_building_levels" | "indexed_defense_counts" | "indexed_moon_building_levels" | "indexed_ship_counts",
    idColumn: string,
    planetId: string,
    itemId: number
  ): number {
    const valueColumn = table.endsWith("building_levels") ? "level" : "count";
    const row = this.db.query(`
      SELECT ${valueColumn} AS value
      FROM ${table}
      WHERE planet_id = ? AND ${idColumn} = ?
    `).get(planetId, itemId) as { value: number } | null;
    return row?.value ?? 0;
  }

  private upsertIndexedLevel(
    table: "contract_building_levels" | "contract_defense_counts" | "contract_moon_building_levels" | "contract_ship_counts" | "indexed_building_levels" | "indexed_defense_counts" | "indexed_moon_building_levels" | "indexed_ship_counts",
    idColumn: string,
    valueColumn: string,
    planetId: string,
    itemId: number,
    value: number
  ): void {
    this.db.query(`
      INSERT INTO ${table} (planet_id, ${idColumn}, ${valueColumn})
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id, ${idColumn}) DO UPDATE SET ${valueColumn} = excluded.${valueColumn}
    `).run(planetId, itemId, value);
  }

  private upsertIndexedLevelAtLeast(
    table: "contract_building_levels" | "contract_moon_building_levels" | "indexed_building_levels" | "indexed_moon_building_levels",
    idColumn: string,
    valueColumn: string,
    planetId: string,
    itemId: number,
    value: number
  ): void {
    this.db.query(`
      INSERT INTO ${table} (planet_id, ${idColumn}, ${valueColumn})
      VALUES (?, ?, ?)
      ON CONFLICT(planet_id, ${idColumn}) DO UPDATE SET ${valueColumn} = max(${table}.${valueColumn}, excluded.${valueColumn})
    `).run(planetId, itemId, value);
  }

  private applyMoonCreatedEvent(event: IndexedMoonCreatedEvent): void {
    this.db.query(`
      INSERT INTO indexed_moons (planet_id, owner, fields, diameter_km, event_json)
      VALUES (?, lower(?), ?, ?, ?)
      ON CONFLICT(planet_id) DO UPDATE SET
        owner = excluded.owner,
        fields = excluded.fields,
        diameter_km = excluded.diameter_km,
        event_json = excluded.event_json
    `).run(event.planetId, event.owner, event.fields, event.diameterKm, JSON.stringify(event));
    this.touch();
  }

  private applyRiftResourceEvent(event: IndexedRiftResourceEvent): void {
    const owner = event.owner.toLowerCase();
    const current = this.riftBalance(owner, event.planetId, event.resourceId);
    const inGameBalance = BigInt(current?.in_game_balance ?? "0");
    const lockedBalance = BigInt(current?.locked_balance ?? "0");
    const amount = BigInt(event.amount);

    if (event.eventName === "MarketResourceDeposited") {
      this.upsertRiftBalance(owner, event.planetId, event.resourceId, inGameBalance + amount, lockedBalance);
    } else if (event.eventName === "MarketResourceWithdrawalRequested") {
      this.upsertRiftBalance(owner, event.planetId, event.resourceId, subtractNonNegative(inGameBalance, amount), lockedBalance + amount);
      this.db.query(`
        INSERT INTO indexed_rift_withdrawals (withdrawal_key, owner, planet_id, resource_id, amount, unlocks_at, event_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(withdrawal_key) DO UPDATE SET
          amount = excluded.amount,
          unlocks_at = excluded.unlocks_at,
          event_json = excluded.event_json
      `).run(riftWithdrawalKey(event), owner, event.planetId, event.resourceId, event.amount, event.unlocksAt ?? "0", JSON.stringify(event));
    } else {
      this.upsertRiftBalance(owner, event.planetId, event.resourceId, inGameBalance, subtractNonNegative(lockedBalance, amount));
      this.db.query(`
        DELETE FROM indexed_rift_withdrawals
        WHERE owner = ? AND planet_id = ? AND resource_id = ? AND amount = ?
      `).run(owner, event.planetId, event.resourceId, event.amount);
    }
    this.touch();
  }

  private applyAllianceEvent(event: IndexedAllianceEvent): void {
    if (event.eventName === "AllianceCreated") {
      this.db.query(`
        INSERT INTO contract_alliances (
          alliance_id, active, tag, name, description, owner, created_at, member_count, event_json
        )
        VALUES (?, 1, ?, ?, '', lower(?), ?, 0, ?)
        ON CONFLICT(alliance_id) DO UPDATE SET
          active = 1,
          tag = excluded.tag,
          name = excluded.name,
          owner = excluded.owner,
          created_at = excluded.created_at,
          event_json = excluded.event_json
      `).run(event.allianceId, event.tag, event.name, event.owner, event.createdAt, JSON.stringify(event));
    } else if (event.eventName === "AllianceProfileUpdated") {
      this.db.query(`
        UPDATE contract_alliances
        SET tag = ?, name = ?, description = ?, event_json = ?
        WHERE alliance_id = ?
      `).run(event.tag, event.name, event.description, JSON.stringify(event), event.allianceId);
    } else if (event.eventName === "AllianceInviteCreated") {
      this.db.query(`
        INSERT INTO contract_alliance_invites (alliance_id, player, inviter, invited_at)
        VALUES (?, lower(?), lower(?), ?)
        ON CONFLICT(alliance_id, player) DO UPDATE SET
          inviter = excluded.inviter,
          invited_at = excluded.invited_at
      `).run(event.allianceId, event.player, event.inviter, event.invitedAt);
    } else if (event.eventName === "AllianceInviteCancelled") {
      this.db.query(`
        DELETE FROM contract_alliance_invites
        WHERE alliance_id = ? AND player = lower(?)
      `).run(event.allianceId, event.player);
    } else if (event.eventName === "AllianceJoinRequested") {
      this.db.query(`
        INSERT INTO contract_alliance_join_requests (alliance_id, requester, requested_at)
        VALUES (?, lower(?), ?)
        ON CONFLICT(alliance_id, requester) DO UPDATE SET
          requested_at = excluded.requested_at
      `).run(event.allianceId, event.requester, event.requestedAt);
    } else if (event.eventName === "AllianceJoinRequestCancelled") {
      this.db.query(`
        DELETE FROM contract_alliance_join_requests
        WHERE alliance_id = ? AND requester = lower(?)
      `).run(event.allianceId, event.player);
    } else if (event.eventName === "AllianceJoinRequestDismissed" || event.eventName === "AllianceJoinRequestApproved") {
      this.db.query(`
        DELETE FROM contract_alliance_join_requests
        WHERE alliance_id = ? AND requester = lower(?)
      `).run(event.allianceId, event.requester);
    } else if (event.eventName === "AllianceJoined") {
      this.db.query(`
        INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at)
        VALUES (?, lower(?), ?, ?)
        ON CONFLICT(alliance_id, wallet) DO UPDATE SET
          role_id = excluded.role_id,
          joined_at = excluded.joined_at
      `).run(event.allianceId, event.player, event.roleId, event.joinedAt);
      this.db.query(`
        UPDATE contract_alliances
        SET member_count = (
          SELECT COUNT(*)
          FROM contract_alliance_members
          WHERE alliance_id = ?
        )
        WHERE alliance_id = ?
      `).run(event.allianceId, event.allianceId);
      this.db.query("DELETE FROM contract_alliance_invites WHERE alliance_id = ? AND player = lower(?)").run(event.allianceId, event.player);
      this.db.query("DELETE FROM contract_alliance_join_requests WHERE alliance_id = ? AND requester = lower(?)").run(event.allianceId, event.player);
    } else if (event.eventName === "AllianceLeft") {
      this.db.query(`
        DELETE FROM contract_alliance_members
        WHERE alliance_id = ? AND wallet = lower(?)
      `).run(event.allianceId, event.player);
      this.db.query(`
        UPDATE contract_alliances
        SET member_count = (
          SELECT COUNT(*)
          FROM contract_alliance_members
          WHERE alliance_id = ?
        )
        WHERE alliance_id = ?
      `).run(event.allianceId, event.allianceId);
    } else if (event.eventName === "AllianceRoleUpdated") {
      this.db.query(`
        UPDATE contract_alliance_members
        SET role_id = ?
        WHERE alliance_id = ? AND wallet = lower(?)
      `).run(event.roleId, event.allianceId, event.player);
    } else if (event.eventName === "AllianceOwnershipTransferred") {
      this.db.query(`
        UPDATE contract_alliances
        SET owner = lower(?)
        WHERE alliance_id = ?
      `).run(event.newOwner, event.allianceId);
    } else if (event.eventName === "AllianceDiplomacyUpdated") {
      this.db.query(`
        INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(alliance_id, other_alliance_id) DO UPDATE SET
          status_id = excluded.status_id,
          updated_at = excluded.updated_at
      `).run(event.allianceId, event.otherAllianceId, event.statusId, event.blockNumber);
      this.db.query(`
        INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(alliance_id, other_alliance_id) DO UPDATE SET
          status_id = excluded.status_id,
          updated_at = excluded.updated_at
      `).run(event.otherAllianceId, event.allianceId, event.statusId, event.blockNumber);
    }

    this.touch();
  }

  private applyAllianceDirectorySnapshot(directory: readonly AllianceState["directory"][number][]): void {
    for (const alliance of directory) {
      this.db.query(`
        INSERT INTO contract_alliances (
          alliance_id, active, tag, name, description, owner, created_at, member_count, event_json
        )
        VALUES (?, ?, ?, ?, ?, lower(?), ?, ?, ?)
        ON CONFLICT(alliance_id) DO UPDATE SET
          active = excluded.active,
          tag = excluded.tag,
          name = excluded.name,
          description = excluded.description,
          owner = excluded.owner,
          created_at = excluded.created_at,
          member_count = excluded.member_count,
          event_json = excluded.event_json
      `).run(
        alliance.allianceId,
        alliance.active ? 1 : 0,
        alliance.tag,
        alliance.name,
        alliance.description,
        alliance.owner,
        alliance.createdAt,
        alliance.memberCount,
        JSON.stringify({
          eventName: "AllianceDirectorySnapshot",
          allianceId: alliance.allianceId,
          active: alliance.active,
          tag: alliance.tag,
          name: alliance.name,
          description: alliance.description,
          owner: alliance.owner,
          createdAt: alliance.createdAt,
          memberCount: alliance.memberCount
        })
      );

      if (!alliance.members) continue;
      this.db.query("DELETE FROM contract_alliance_members WHERE alliance_id = ?").run(alliance.allianceId);
      for (const member of alliance.members) {
        this.db.query(`
          INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at)
          VALUES (?, lower(?), ?, ?)
          ON CONFLICT(alliance_id, wallet) DO UPDATE SET
            role_id = excluded.role_id,
            joined_at = excluded.joined_at
        `).run(alliance.allianceId, member.address, allianceRoleId(member.role), member.joinedAt);
      }
    }

    if (directory.length > 0) this.touch();
  }

  // Canonical-mirror seed for contract_alliance_join_requests. null snapshot => reader can't read it,
  // keep event-derived rows; non-null => DELETE+replace so the table mirrors the chain exactly (an
  // empty array clears stale event rows that no longer exist on chain).
  private applyAllianceJoinRequestSnapshot(snapshot: AllianceJoinRequestSnapshot[] | null): void {
    if (snapshot === null) return;
    this.db.query("DELETE FROM contract_alliance_join_requests").run();
    for (const request of snapshot) {
      this.db.query(`
        INSERT INTO contract_alliance_join_requests (alliance_id, requester, requested_at)
        VALUES (?, lower(?), ?)
        ON CONFLICT(alliance_id, requester) DO UPDATE SET
          requested_at = excluded.requested_at
      `).run(request.allianceId, request.requester, request.requestedAt);
    }
    this.touch();
  }

  // Canonical-mirror seed for contract_alliance_invites. See applyAllianceJoinRequestSnapshot for the
  // null vs. empty-array semantics.
  private applyAllianceInviteSnapshot(snapshot: AllianceInviteSnapshot[] | null): void {
    if (snapshot === null) return;
    this.db.query("DELETE FROM contract_alliance_invites").run();
    for (const invite of snapshot) {
      this.db.query(`
        INSERT INTO contract_alliance_invites (alliance_id, player, inviter, invited_at)
        VALUES (?, lower(?), lower(?), ?)
        ON CONFLICT(alliance_id, player) DO UPDATE SET
          inviter = excluded.inviter,
          invited_at = excluded.invited_at
      `).run(invite.allianceId, invite.player, invite.inviter, invite.invitedAt);
    }
    this.touch();
  }

  // Canonical-mirror seed for contract_alliance_diplomacy. The reader returns one row per directed
  // (alliance_id, other_alliance_id) pair, matching the AllianceDiplomacyUpdated handler that writes both
  // directions; updated_at is left NULL on the chain seed (no event block backs it). See null vs.
  // empty-array semantics on applyAllianceJoinRequestSnapshot.
  private applyAllianceDiplomacySnapshot(snapshot: AllianceDiplomacySnapshot[] | null): void {
    if (snapshot === null) return;
    this.db.query("DELETE FROM contract_alliance_diplomacy").run();
    for (const relation of snapshot) {
      this.db.query(`
        INSERT INTO contract_alliance_diplomacy (alliance_id, other_alliance_id, status_id, updated_at)
        VALUES (?, ?, ?, NULL)
        ON CONFLICT(alliance_id, other_alliance_id) DO UPDATE SET
          status_id = excluded.status_id
      `).run(relation.allianceId, relation.otherAllianceId, relation.statusId);
    }
    this.touch();
  }

  private touch(): void {
    this.stateGeneration += 1;
    this.setMetadata("lastRebuiltAt", new Date().toISOString());
  }

  private recordLog(eventId: string, log: IndexedRpcLog): boolean {
    const result = this.db.query(`
      INSERT INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `).run(
      eventId,
      log.transactionHash,
      log.logIndex ?? "0x0",
      blockNumberToDecimal(log.blockNumber),
      log.removed ? 1 : 0,
      JSON.stringify(log),
      new Date().toISOString()
    );
    return result.changes > 0;
  }

  private recordLogIfMissing(log: IndexedRpcLog): void {
    const eventId = indexedLogKey(log);
    const existing = this.db.query("SELECT event_json FROM indexed_event_logs WHERE event_id = ?").get(eventId) as EventRow | null;
    if (existing) return;
    this.recordLog(eventId, log);
    this.recordLatestBlock(log.blockNumber);
  }

  private recordPlayerActivityFromLog(eventId: string, log: IndexedRpcLog): void {
    const lastActiveAt = blockTimestampSeconds(log);
    if (!lastActiveAt) return;

    const owner = this.playerActivityOwnerForLog(log);
    if (!owner) return;

    this.db.query(`
      INSERT INTO indexed_player_activity (wallet, last_active_at, event_id)
      VALUES (lower(?), ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        last_active_at = CASE
          WHEN CAST(excluded.last_active_at AS INTEGER) > CAST(indexed_player_activity.last_active_at AS INTEGER)
          THEN excluded.last_active_at
          ELSE indexed_player_activity.last_active_at
        END,
        event_id = CASE
          WHEN CAST(excluded.last_active_at AS INTEGER) > CAST(indexed_player_activity.last_active_at AS INTEGER)
          THEN excluded.event_id
          ELSE indexed_player_activity.event_id
        END
    `).run(owner, lastActiveAt, eventId);
  }

  private playerActivityOwnerForLog(log: IndexedRpcLog): Address | null {
    try {
      if (isSettledPlanetLog(log)) return decodeSettledPlanetLog(log).owner;
      if (isPlanetRenamedLog(log)) return decodePlanetRenamedLog(log).owner;
      if (isRiftResourceLog(log)) return decodeRiftResourceLog(log).owner;

      if (isIndexedQueueStartedLog(log)) {
        const event = decodeIndexedQueueStartedLog(log);
        return event.owner ?? this.ownerForPlanetActivity(event.planetId);
      }

      if (isIndexedQueueCompletedLog(log)) {
        const event = decodeIndexedQueueCompletedLog(log);
        return event.owner ?? this.ownerForPlanetActivity(event.planetId);
      }

      if (isPlanetSettledLog(log)) return this.ownerForPlanetActivity(decodePlanetSettledLog(log).planetId);
      if (isShipCountChangedLog(log)) return this.ownerForPlanetActivity(decodeShipCountChangedLog(log).planetId);
      if (isDefenseCountChangedLog(log)) return this.ownerForPlanetActivity(decodeDefenseCountChangedLog(log).planetId);
      if (isMoonCreatedLog(log)) return decodeMoonCreatedLog(log).owner;

      if (isFleetMissionLog(log)) {
        const mission = [...decodeFleetMissionLogs([log]).values()][0];
        return mission?.owner ?? null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private ownerForPlanetActivity(planetId: string | undefined): Address | null {
    if (!planetId) return null;
    return this.planet(planetId)?.owner ?? null;
  }

  private recordRemovedLog(eventId: string, log: IndexedRpcLog): void {
    this.db.query(`
      INSERT OR IGNORE INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(
      eventId,
      log.transactionHash,
      `${log.logIndex ?? "0x0"}:removed`,
      blockNumberToDecimal(log.blockNumber),
      JSON.stringify(log),
      new Date().toISOString()
    );
  }

  private markReorgDetected(): void {
    this.setMetadata("reorgDetectedAt", new Date().toISOString());
  }

  // `latestIndexedBlock` is the high-water mark of indexed blocks and the snapshot the departed-ships
  // reconcile baseline is pinned to (refreshCanonicalStateUncached). It MUST only ever move forward.
  // Logs do not always reach us in block order — a gap/reorg recovery or self-heal backfill can re-apply
  // an older range after the live head feed has already advanced — and a non-monotonic write would drag
  // the head backwards. A regressed head freezes the reconcile baseline below missions that have already
  // launched AND returned, so the debit-only projection keeps subtracting them and their ships vanish
  // from the shipyard (at-planet shows 0). Clamp to the max so a stale write can never lower it.
  private recordLatestBlock(blockNumber: string): void {
    const next = blockNumberToDecimal(blockNumber);
    const current = this.metadata("latestIndexedBlock");
    if (current !== null) {
      try {
        if (BigInt(next) <= BigInt(current)) return;
      } catch {
        // If either value isn't a parseable integer, fall through and overwrite with the latest write.
      }
    }
    this.setMetadata("latestIndexedBlock", next);
  }

  private recordSuccessfulReconciliation(latestBlock: string | null): void {
    const now = new Date().toISOString();
    this.setMetadata("lastReconciledAt", now);
    this.setMetadata("lastReconciledBlock", latestBlock ?? this.fromBlock.toString());
    this.db.query("DELETE FROM indexer_metadata WHERE key = 'lastReconciliationError'").run();
    this.db.query("DELETE FROM indexer_metadata WHERE key = 'pendingReconciliationReason'").run();
    if (latestBlock) {
      this.recordLatestBlock(latestBlock);
    }
  }

  private recordSuccessfulAllianceReconciliation(): void {
    this.setMetadata("allianceReconciledAt", new Date().toISOString());
  }

  private recordReconciliationError(error: unknown): void {
    this.setMetadata("lastReconciliationError", error instanceof Error ? error.message : String(error));
  }

  private setMetadata(key: string, value: string): void {
    this.db.query(`
      INSERT INTO indexer_metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private moon(planetId: string): IndexedMoonCreatedEvent | null {
    const row = this.db.query("SELECT event_json FROM indexed_moons WHERE planet_id = ?").get(planetId) as MoonRow | null;
    return row ? parseEvent<IndexedMoonCreatedEvent>(row.event_json) : null;
  }

  private riftBalances(wallet: `0x${string}`, planetId: string | null): RiftBalanceRow[] {
    if (!planetId) return [];
    return this.db.query(`
      SELECT resource_id, in_game_balance, locked_balance
      FROM indexed_rift_balances
      WHERE owner = lower(?) AND planet_id = ?
      ORDER BY resource_id ASC
    `).all(wallet, planetId) as RiftBalanceRow[];
  }

  private riftBalance(owner: string, planetId: string, resourceId: number): RiftBalanceRow | null {
    return this.db.query(`
      SELECT resource_id, in_game_balance, locked_balance
      FROM indexed_rift_balances
      WHERE owner = lower(?) AND planet_id = ? AND resource_id = ?
    `).get(owner, planetId, resourceId) as RiftBalanceRow | null;
  }

  private upsertRiftBalance(owner: string, planetId: string, resourceId: number, inGameBalance: bigint, lockedBalance: bigint): void {
    this.db.query(`
      INSERT INTO indexed_rift_balances (owner, planet_id, resource_id, in_game_balance, locked_balance)
      VALUES (lower(?), ?, ?, ?, ?)
      ON CONFLICT(owner, planet_id, resource_id) DO UPDATE SET
        in_game_balance = excluded.in_game_balance,
        locked_balance = excluded.locked_balance
    `).run(owner, planetId, resourceId, inGameBalance.toString(), lockedBalance.toString());
  }

  private pendingWithdrawals(wallet: `0x${string}`, planetId: string | null): PendingWithdrawalRow[] {
    if (!planetId) return [];
    return this.db.query(`
      SELECT withdrawal_key, resource_id, amount, unlocks_at
      FROM indexed_rift_withdrawals
      WHERE owner = lower(?) AND planet_id = ?
      ORDER BY CAST(unlocks_at AS INTEGER) ASC
    `).all(wallet, planetId) as PendingWithdrawalRow[];
  }

  private indexedFleetMissionSummaries(): FleetMissionSummary[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
      ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC
    `).all() as EventRow[];
    const logs = rows
      .map((row) => parseEvent<IndexedRpcLog>(row.event_json))
      .filter(isFleetMissionLog);
    // VEY-KANEO-479: decode leaves `needsResolution` at its default; compute it here so an arrived
    // Attack only reads "Ready to resolve" once its battle randomness is fulfilled (gated on the
    // ingested RandomnessFulfilled logs). Harvest and the other types stay on the plain arrival check.
    const missions = decodeCompleteFleetMissionLogs(logs);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    // Only an arrived Attack awaiting its randomness needs the fulfillment scan; skip it (and the
    // extra full-table read it does) whenever nothing is actually gated, which is the common case.
    const needsGate = this.randomnessEngineConfigured && missions.some(
      (mission) =>
        missionBattleRandomnessRequestId(mission) !== null
        && mission.status === "Outbound"
        && Number(mission.arrivalAt) <= nowSeconds
    );
    const fulfilledRandomnessRequestIds = needsGate ? this.fulfilledRandomnessRequestIds() : null;
    return missions.map((mission) => ({
      ...mission,
      needsResolution: fleetMissionNeedsResolution(mission, nowSeconds, fulfilledRandomnessRequestIds)
    }));
  }

  // VEY-KANEO-479: request ids the RandomnessEngine has fulfilled, read from the ingested
  // RandomnessFulfilled logs.
  private fulfilledRandomnessRequestIds(): ReadonlySet<string> {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
      ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC
    `).all() as EventRow[];
    const fulfilled = new Set<string>();
    for (const row of rows) {
      const log = parseEvent<IndexedRpcLog>(row.event_json);
      if (isRandomnessFulfilledLog(log)) {
        fulfilled.add(decodeRandomnessFulfilledRequestId(log));
      }
    }
    return fulfilled;
  }

  // VEY-KANEO-489: replay every Attack `attacker` has launched, grouped by target planet, as ascending
  // launch timestamps. The contract anchors each per-(attacker, defender, planet) bashing window at
  // block.timestamp of the launch (VeydriftGameStorage._recordAttack runs in the FleetMissionLaunched
  // transaction), so the server can derive the live window count from these and apply the same
  // MAX_ATTACKS_PER_BASHING_WINDOW / 24h reset the contract enforces — letting the indexed
  // attack-protection preview report bashing_limit instead of silently allowing a blocked attack.
  // We key only by (attacker, planet), dropping the contract's defender dimension: planet ids are
  // minted monotonically (nextPlanetId++) and never reassigned to a different non-zero owner (attacks
  // loot but never capture; abandonment cannot re-mint an id), so a given planet id maps to exactly one
  // defender over its lifetime — making (attacker, planet) equivalent to (attacker, defender, planet).
  // Launches whose block lacks an ingested timestamp are skipped (they cannot be placed in the 24h
  // window), which biases toward not-blocking rather than fabricating a window position.
  attackLaunchSecondsByTarget(attacker: `0x${string}`): Map<string, number[]> {
    const normalizedAttacker = attacker.toLowerCase();
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
      ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC
    `).all() as EventRow[];
    const byTarget = new Map<string, number[]>();
    for (const row of rows) {
      const log = parseEvent<IndexedRpcLog>(row.event_json);
      const launch = decodeAttackMissionLaunch(log);
      if (!launch || launch.attacker.toLowerCase() !== normalizedAttacker) continue;
      const launchedAt = blockTimestampSeconds(log);
      if (launchedAt === undefined) continue;
      const seconds = Number(launchedAt);
      if (!Number.isFinite(seconds)) continue;
      const existing = byTarget.get(launch.targetPlanetId);
      if (existing) existing.push(seconds);
      else byTarget.set(launch.targetPlanetId, [seconds]);
    }
    return byTarget;
  }

  private indexedBattleReports(): BattleReport[] {
    const rows = this.db.query(`
      SELECT event_json
      FROM indexed_event_logs
      WHERE removed = 0
      ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC
    `).all() as EventRow[];
    const logs = rows
      .map((row) => parseEvent<IndexedRpcLog>(row.event_json))
      .filter(isBattleReportLog);
    // Enrich each report with its ACS attack group participants + per-participant loot, joining the
    // decoded battle reports against the fleet-mission read model (which carries joinedAttackMissionIds
    // and each joiner's resulting return-leg cargo). Solo attacks come back with a single participant.
    return attachAttackGroupParticipants(decodeBattleReports(logs), this.indexedFleetMissionSummaries());
  }

  // VEY-KANEO-456: resolve an incoming attack's stationed allied defenders into the per-defender detail
  // the Stationed defenses panel renders — defender identity, full ship composition, hold-until, and the
  // defended planet's Alliance Depot level (which funds the deuterium upkeep). Applies the lazy
  // reconciliation the ticket requires: a defender is only stationed while its AcsDefend mission is still
  // Outbound and its hold (arrivalAt) has not elapsed as-of-now, so expired/withdrawn holds drop out on
  // read without waiting for a settlement event. Sorted soonest-expiring first.
  private stationedDefendersForAttack(
    attack: FleetMissionSummary,
    summariesById: Map<string, FleetMissionSummary>,
    nowSeconds: number
  ): StationedDefenderSummary[] {
    const allianceDepotLevel = attack.targetPlanet?.allianceDepotLevel ?? 0;
    return (attack.counterplayDefenderMissionIds ?? [])
      .map((missionId) => summariesById.get(missionId))
      .filter((defender): defender is FleetMissionSummary =>
        defender !== undefined
          && defender.missionType === "AcsDefend"
          && defender.status === "Outbound"
          && Number(defender.arrivalAt) > nowSeconds)
      .map((defender) => ({
        missionId: defender.missionId,
        defender: defender.owner,
        defenderDisplayName: this.playerProfile(defender.owner).displayName,
        ships: defender.ships,
        holdUntil: defender.arrivalAt,
        allianceDepotLevel
      }))
      .sort((left, right) => Number(left.holdUntil) - Number(right.holdUntil));
  }

  private stationedDefenderSummary(defender: FleetMissionSummary, holdUntil: string): StationedDefenderSummary {
    const targetPlanet = defender.targetPlanet ?? this.fleetMissionPlanetReference(defender.targetPlanetId);
    return {
      missionId: defender.missionId,
      defender: defender.owner,
      defenderDisplayName: this.playerProfile(defender.owner).displayName,
      ships: defender.ships,
      holdUntil,
      allianceDepotLevel: targetPlanet?.allianceDepotLevel ?? 0
    };
  }

  private isActiveDefenseHoldForPlanet(
    mission: FleetMissionSummary,
    planetId: string,
    asOfSeconds: number
  ): boolean {
    const holdUntil = Number(this.defenseHoldWindowEnd(mission));
    return mission.missionType === "DefenseHold"
      && mission.status === "Outbound"
      && mission.targetPlanetId === planetId
      && Number(mission.arrivalAt) <= asOfSeconds
      && Number.isFinite(holdUntil)
      && holdUntil > asOfSeconds
      && hasAnyShips(mission.ships);
  }

  private isBattleTimeCounterplay(
    defender: FleetMissionSummary,
    attack: FleetMissionSummary,
    attackArrival: number
  ): boolean {
    return ["AcsDefend", "Intercept", "DefenseHold"].includes(defender.missionType)
      && defender.targetPlanetId === attack.targetPlanetId
      && Number(defender.arrivalAt) <= attackArrival
      && Number(this.counterplayHoldUntil(defender)) >= attackArrival
      && hasAnyShips(defender.ships);
  }

  private isBattleTimeDefenseHoldForPlanet(
    defender: FleetMissionSummary,
    planetId: string,
    attackArrival: number
  ): boolean {
    return defender.missionType === "DefenseHold"
      && defender.targetPlanetId === planetId
      && Number(defender.arrivalAt) <= attackArrival
      && Number(this.defenseHoldWindowEnd(defender)) >= attackArrival
      && hasAnyShips(defender.ships);
  }

  private counterplayHoldUntil(defender: FleetMissionSummary): string {
    return defender.defenseHoldUntil ?? defender.arrivalAt;
  }

  private defenseHoldWindowEnd(defender: FleetMissionSummary): string {
    // New deployments emit DefenseHoldStationed with the exact hold expiry. Older live missions only
    // have FleetMissionLaunched, where returnAt is hold expiry plus flight-home time; use it as a
    // conservative public-intel fallback so legacy held defenders are not invisible.
    return defender.defenseHoldUntil ?? defender.returnAt;
  }

  // VEY-KANEO-471: build one fully-populated synthetic incoming attack (with two stationed defenders)
  // so QA can verify the Stationed defenses panel — defender identity, per-unit assets + counts, live
  // hold countdown, and Alliance Depot upkeep/sustain — without staging a real multi-wallet ACS Defend
  // scenario on-chain. Only ever reachable when the (non-production-gated) flag is set. Returns null if
  // the wallet owns no planet, so it never fabricates planet ownership. The synthetic mission ids are
  // prefixed `qa-synthetic-*` so they are visually unmistakable and cannot collide with on-chain ids.
  private syntheticStationedDefenseAttack(
    wallet: `0x${string}`,
    ownedPlanetIds: Set<string>,
    nowSeconds: number
  ): FleetMissionSummary | null {
    const targetPlanetId = [...ownedPlanetIds].sort((left, right) => Number(left) - Number(right))[0];
    if (targetPlanetId === undefined) return null;
    const targetPlanet = this.fleetMissionPlanetReference(targetPlanetId);
    const allianceDepotLevel = targetPlanet?.allianceDepotLevel ?? 5;
    const arrivalAt = String(nowSeconds + 3_600);

    const stationedDefenders: StationedDefenderSummary[] = [
      {
        missionId: "qa-synthetic-defender-1",
        defender: "0x00000000000000000000000000000000000DEF01",
        defenderDisplayName: "QA Ally Alpha",
        ships: { lightFighter: "12", cruiser: "3", battleship: "1" },
        holdUntil: String(nowSeconds + 6 * 3_600),
        allianceDepotLevel
      },
      {
        missionId: "qa-synthetic-defender-2",
        defender: "0x00000000000000000000000000000000000DEF02",
        defenderDisplayName: "QA Ally Beta",
        ships: { smallCargo: "20", heavyFighter: "8", destroyer: "2" },
        holdUntil: String(nowSeconds + 18 * 3_600),
        allianceDepotLevel
      }
    ];

    return withMissionAsOfNow(
      {
        missionId: "qa-synthetic-attack",
        status: "Outbound",
        missionType: "Attack",
        owner: "0x00000000000000000000000000000000000A77AC",
        originPlanetId: "0",
        targetPlanetId,
        originPlanet: null,
        targetPlanet,
        arrivalAt,
        returnAt: "0",
        fuelCost: "0",
        recallCost: null,
        attackGroupId: null,
        joinedAttackMissionIds: [],
        defendsMissionId: null,
        counterplayDefenderMissionIds: stationedDefenders.map((defender) => defender.missionId),
        stationedDefenders,
        cargo: zeroResources(),
        returnCargo: null,
        ships: { lightFighter: "40", cruiser: "6" },
        transactionHash: "0xqa-synthetic-stationed-defense",
        blockNumber: "0",
        launchBlockNumber: "0",
        needsResolution: false
      },
      nowSeconds
    );
  }

  private withFleetMissionPlanetReferences(mission: FleetMissionSummary): FleetMissionSummary {
    return withMissionAsOfNow(
      {
        ...mission,
        originPlanet: this.fleetMissionPlanetReference(mission.originPlanetId),
        targetPlanet: this.fleetMissionPlanetReference(mission.targetPlanetId)
      },
      nowSeconds()
    );
  }

  private fleetMissionPlanetReference(planetId: string): FleetMissionPlanetReference | null {
    const planet = this.planet(planetId);
    if (!planet) return null;
    return {
      planetId: planet.planetId,
      owner: planet.owner,
      ownerDisplayName: this.playerProfile(planet.owner).displayName,
      name: planet.name,
      galaxy: planet.galaxy,
      system: planet.system,
      position: planet.position,
      coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
      archetype: planetArchetypeForTemperature(planet.temperature),
      // VEY-KANEO-440: surface the Alliance Depot level (building id 13) so the ACS Defend compose UX
      // can preview how much holding fuel the defended planet's depot subsidizes.
      allianceDepotLevel: this.infrastructureRows(planet.planetId).find((building) => building.id === 13)?.level ?? 0
    };
  }

  private count(table:
    | "indexed_debris_fields"
    | "indexed_event_logs"
    | "indexed_moon_chance_reports"
    | "indexed_moons"
    | "indexed_planets"
    | "indexed_rift_balances"
  ): number {
    const row = this.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
    return row.count;
  }

  private metadata(key: string): string | null {
    const row = this.db.query("SELECT value FROM indexer_metadata WHERE key = ?").get(key) as MetadataRow | null;
    return row?.value ?? null;
  }

  private rows<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    return (this.db.query(sql).all(...params) as EventRow[]).map((row) => parseEvent<T>(row.event_json));
  }

  private planetsFromRows(sql: string, ...params: SQLQueryBindings[]): SettledPlanetEvent[] {
    return this.rows<SettledPlanetEvent>(sql, ...params).map((planet) => this.withResourceSnapshot(planet));
  }

  private blockingStaleReason({
    lastReconciledAt,
    lastReconciliationError,
    pendingReconciliationReason
  }: {
    lastReconciledAt: string | null;
    lastReconciliationError: string | null;
    pendingReconciliationReason: string | null;
  }): string | null {
    if (lastReconciliationError) {
      // A reconcile *error* must NOT take the service down once a full reconciliation has succeeded
      // at least once: the websocket-synced indexed read model is authoritative between events, so
      // serve the last good state and let the reconcile retry in the background. The error stays
      // visible via the `lastReconciliationError` snapshot field. The pending reason that this
      // failed reconcile was attempting to clear is moot for gating, so ignore it too — otherwise a
      // transient truncated/empty RPC body ("Unexpected end of JSON input") would flip serving off.
      // Only a cold start that has never reconciled is genuinely unserveable (VEY-KANEO-461 rework).
      if (!lastReconciledAt) return `reconciliation_failed: ${lastReconciliationError}`;
      return null;
    }
    if (pendingReconciliationReason && (!lastReconciledAt || !isNonBlockingPendingReason(pendingReconciliationReason))) {
      return pendingReconciliationReason;
    }
    if (!lastReconciledAt) return "never_reconciled";
    return null;
  }

  private allianceStaleReason({
    allianceReconciledAt,
    lastReconciliationError,
    reconciliationInProgress
  }: {
    allianceReconciledAt: string | null;
    lastReconciliationError: string | null;
    reconciliationInProgress: boolean;
  }): string | null {
    // Mirror blockingStaleReason: once an alliance reconciliation has succeeded, a later reconcile
    // error must not gate alliance serving — keep serving the indexed alliance state and retry in
    // the background (VEY-KANEO-461 rework).
    if (allianceReconciledAt) return null;
    if (lastReconciliationError) return `reconciliation_failed: ${lastReconciliationError}`;
    if (reconciliationInProgress) return "reconciliation_in_progress";
    return "alliance_never_reconciled";
  }
}

type CanonicalReconciliationState = {
  resources: Map<string, Resources>;
  planetQueues: Map<string, QueueState>;
  buildings: Map<string, InfrastructureState["buildings"]>;
  defenses: Map<string, DefenseState["defenses"]>;
  ships: Map<string, ShipyardState["ships"]>;
  research: Map<`0x${string}`, ResearchState["technologies"]>;
  researchQueues: Map<`0x${string}`, QueueState>;
  // Canonical moon building levels by moon home-planet id, and the planet's active moon-building queue.
  // Seeded from getMoonState (wallet -> home-planet moon). null entries are intentionally absent.
  moonBuildings: Map<string, MoonState["buildings"]>;
  moonQueues: Map<string, QueueState>;
  verifiedEmptyQueues: Set<string>;
};

function moonChanceReportKey(event: MoonChanceReportEvent): string {
  return event.outcomeId ? `outcome:${event.outcomeId}` : `battle:${event.battleId}:${event.targetPlanetId}`;
}

function queueKey(event: Pick<IndexedQueueStartedEvent | IndexedQueueCompletedEvent, "queueKind" | "planetId" | "owner">): string {
  if (event.queueKind === "research") {
    return `research:${event.owner?.toLowerCase() ?? ""}`;
  }

  return `${event.queueKind}:${event.planetId ?? ""}`;
}

function isPlanetQueueKind(value: string): value is "building" | "defense" | "ship" {
  return value === "building" || value === "defense" || value === "ship";
}

function openIndexerDatabase(databasePath: string): Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = new Database(databasePath);
  database.exec("PRAGMA busy_timeout = 10000;");
  if (databasePath !== ":memory:") {
    // Read-concurrency tuning for the API's read-heavy traffic (VEY-KANEO-467):
    // - WAL lets readers run without blocking the background event-integration writer.
    // - synchronous = NORMAL is the WAL-safe default (durable across app crashes; only a power
    //   loss can lose the last commit, which the chain re-supplies on the next sync).
    // - mmap_size / cache_size keep the hot read-model tables resident so warm reads avoid disk.
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = NORMAL;");
    database.exec("PRAGMA mmap_size = 268435456;");
    database.exec("PRAGMA cache_size = -16384;");
  }
  return database;
}

function parseEvent<T>(value: string): T {
  return JSON.parse(value) as T;
}

function sortRpcLogs(logs: readonly RpcLog[]): RpcLog[] {
  return [...logs].sort((left, right) => {
    const blockDelta = compareBigIntish(left.blockNumber, right.blockNumber);
    if (blockDelta !== 0) return blockDelta;
    return compareBigIntish((left as IndexedRpcLog).logIndex ?? "0x0", (right as IndexedRpcLog).logIndex ?? "0x0");
  });
}

function compareBigIntish(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function mergeCurrentPlanetSnapshots(
  settledPlanetEvents: SettledPlanetEvent[],
  currentPlanets: SettledPlanetEvent[]
): SettledPlanetEvent[] {
  const settledByPlanetId = new Map(settledPlanetEvents.map((event) => [event.planetId, event]));
  return currentPlanets.map((planet) => {
    const settled = settledByPlanetId.get(planet.planetId);
    if (!settled) return planet;

    return {
      ...planet,
      blockNumber: settled.blockNumber,
      eventName: settled.eventName,
      transactionHash: settled.transactionHash
    };
  });
}

function indexedManagedPlanet(
  planet: SettledPlanetEvent,
  homePlanetId: string | null,
  buildings: InfrastructureState["buildings"] = [],
  queues: Pick<ManagedPlanet["queues"], "building" | "defense" | "ship"> = {
    building: null,
    defense: null,
    ship: null
  }
): ManagedPlanet {
  const level = (id: number) => buildings.find((building) => building.id === id)?.level ?? 0;

  return {
    ...planet,
    coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
    isHomePlanet: planet.planetId === homePlanetId,
    fieldsUsed: usedFieldsFromBuildingRows(buildings),
    fieldsCapacity: planet.fields,
    keyLevels: {
      metalMine: level(0),
      crystalMine: level(1),
      deuteriumSynthesizer: level(2),
      solarPlant: level(3),
      roboticsFactory: level(4),
      shipyard: level(5),
      researchLab: level(6),
      terraformer: level(12)
    },
    queues,
    moon: null
  };
}

function isZeroResourcePlaceholder(event: SettledPlanetEvent): boolean {
  return event.lastSettledAt === "0"
    && event.resources.metal === "0"
    && event.resources.crystal === "0"
    && event.resources.deuterium === "0";
}

function pendingPlanetResourcesReason(planetId: string): string {
  return `planet_resources_pending:${planetId}`;
}

function isPlanetHydrationPendingReason(reason: string | null): boolean {
  return Boolean(
    reason?.startsWith("planet_resources_pending:")
    || reason?.startsWith("planet_identity_pending:")
  );
}

// Transient websocket-triggered reconcile reasons. These are background refreshes
// (the websocket keeps the indexed state live), not signals that we know data is
// missing — so once a full reconciliation already exists they must not gate serving.
function isTransientWebsocketReason(reason: string | null): boolean {
  return Boolean(
    reason?.startsWith("websocket reconnected")
    || reason?.startsWith("websocket head gap")
    || reason?.startsWith("websocket log decode/apply failure")
  );
}

function isNonBlockingPendingReason(reason: string | null): boolean {
  return isPlanetHydrationPendingReason(reason) || isTransientWebsocketReason(reason);
}

function subtractResources(left: QueueState["cost"], right: QueueState["cost"]): QueueState["cost"] {
  return {
    metal: subtractResource(left.metal, right.metal),
    crystal: subtractResource(left.crystal, right.crystal),
    deuterium: subtractResource(left.deuterium, right.deuterium)
  };
}

function resourcesWithClaimableAccrual(
  current: Resources,
  productionPerHour: Resources | null,
  storageCaps: Resources | null,
  elapsedSeconds: number
): Resources {
  if (!productionPerHour || !storageCaps || elapsedSeconds <= 0) return current;

  return {
    metal: resourceWithClaimableAccrual(current.metal, productionPerHour.metal, storageCaps.metal, elapsedSeconds),
    crystal: resourceWithClaimableAccrual(current.crystal, productionPerHour.crystal, storageCaps.crystal, elapsedSeconds),
    deuterium: resourceWithClaimableAccrual(current.deuterium, productionPerHour.deuterium, storageCaps.deuterium, elapsedSeconds)
  };
}

function resourceWithClaimableAccrual(
  current: string,
  productionPerHour: string,
  storageCap: string,
  elapsedSeconds: number
): string {
  const currentValue = Number(current);
  const rate = Math.max(0, Number(productionPerHour));
  const cap = Number(storageCap);
  if (!Number.isFinite(currentValue) || !Number.isFinite(rate) || !Number.isFinite(cap)) return current;

  const produced = Math.floor((rate * elapsedSeconds) / 3_600);
  const remainingCapacity = Math.max(0, cap - currentValue);
  return Math.floor(currentValue + Math.min(produced, remainingCapacity)).toString();
}

function queueStateFromEvent(event: QueueUpsertEvent): QueueState {
  const queue: QueueState = {
    active: true,
    kind: event.queueKind,
    itemId: event.itemId,
    readyAt: event.readyAt,
    cost: event.cost
  };
  if (event.targetLevel !== undefined) queue.targetLevel = event.targetLevel;
  if (event.quantity !== undefined) queue.quantity = event.quantity;
  if (event.startedAt !== undefined) queue.startedAt = event.startedAt;
  if (event.backlog?.length) queue.backlog = event.backlog;
  return queue;
}

function subtractResource(left: string, right: string): string {
  const result = BigInt(left) - BigInt(right);
  return result > 0n ? result.toString() : "0";
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function levelRows(rows: readonly LevelRow[] | undefined): Array<{ id: number; level: number }> {
  return (rows ?? []).map((row) => ({ id: row.id, level: row.value }));
}

function countRows(rows: readonly LevelRow[] | undefined): Array<{ id: number; count: number }> {
  return (rows ?? []).map((row) => ({ id: row.id, count: row.value }));
}

function isVisibleCompletedMission(
  mission: FleetMissionSummary,
  walletLower: string,
  ownedPlanetIds: ReadonlySet<string>
): boolean {
  if (mission.status !== "Resolved" && mission.status !== "Returned") return false;
  return mission.owner.toLowerCase() === walletLower || ownedPlanetIds.has(mission.targetPlanetId);
}

function compareFleetMissionsNewestFirst(left: FleetMissionSummary, right: FleetMissionSummary): number {
  const leftTime = Number(left.status === "Returned" ? left.returnAt : left.arrivalAt);
  const rightTime = Number(right.status === "Returned" ? right.returnAt : right.arrivalAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  const leftBlock = BigInt(left.blockNumber);
  const rightBlock = BigInt(right.blockNumber);
  if (leftBlock !== rightBlock) return rightBlock > leftBlock ? 1 : -1;
  const leftMission = BigInt(left.missionId);
  const rightMission = BigInt(right.missionId);
  if (leftMission === rightMission) return 0;
  return rightMission > leftMission ? 1 : -1;
}

// Soonest-event-first ordering for active missions: returning/recalled fleets sort by their
// return time, in-flight fleets by arrival. Keeps the universe-wide "All" feed deterministic
// (the frontend re-sorts its rows, but a stable backend order keeps pagination/tests predictable).
function compareFleetMissionsActiveSoonestFirst(left: FleetMissionSummary, right: FleetMissionSummary): number {
  const nextEvent = (mission: FleetMissionSummary): number =>
    Number(mission.status === "Returning" || mission.status === "Recalled" ? mission.returnAt : mission.arrivalAt);
  const leftTime = nextEvent(left);
  const rightTime = nextEvent(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftMission = BigInt(left.missionId);
  const rightMission = BigInt(right.missionId);
  if (leftMission === rightMission) return 0;
  return leftMission > rightMission ? 1 : -1;
}

const moonBuildingRows = [
  { id: 0, key: "lunarBase", label: "Lunar Base" },
  { id: 2, key: "jumpGate", label: "Jump Gate" }
];
const riftResourceRows = [
  { key: "metal" as const, label: "Metal", resourceId: 0 },
  { key: "crystal" as const, label: "Crystal", resourceId: 1 },
  { key: "deuterium" as const, label: "Deuterium", resourceId: 2 }
];

function indexedLogKey(log: IndexedRpcLog): string {
  return `${log.transactionHash.toLowerCase()}:${log.logIndex ?? fallbackLogIndex(log)}`;
}

function fallbackLogIndex(log: RpcLog): string {
  return `${log.blockNumber}:${log.topics.join(",")}:${log.data}`;
}

function blockTimestampSeconds(log: IndexedRpcLog): string | undefined {
  if (!log.blockTimestamp) return undefined;

  try {
    return decodeIntegerString(log.blockTimestamp).toString();
  } catch {
    return undefined;
  }
}

function blockNumberToDecimal(blockNumber: string): string {
  try {
    return decodeIntegerString(blockNumber).toString();
  } catch {
    return blockNumber;
  }
}

function allianceRoleName(roleId: number): AllianceState["membership"]["role"] {
  if (!allianceRoleIds.includes(roleId)) return "none";
  if (roleId === 1) return "member";
  if (roleId === 2) return "officer";
  if (roleId === 3) return "owner";
  return "none";
}

function allianceRoleId(role: AllianceState["membership"]["role"]): number {
  if (role === "member") return 1;
  if (role === "officer") return 2;
  if (role === "owner") return 3;
  return 0;
}

function decodeIntegerString(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return BigInt(Number(value));
  }
}

function subtractNonNegative(left: bigint, right: bigint): bigint {
  return left > right ? left - right : 0n;
}

function riftWithdrawalKey(event: IndexedRiftResourceEvent): string {
  return `${event.transactionHash.toLowerCase()}:${event.planetId}:${event.resourceId}:${event.amount}`;
}

function hasAnyShips(ships: Record<string, string>): boolean {
  return Object.values(ships).some((count) => {
    try {
      return BigInt(count) > 0n;
    } catch {
      return Number(count) > 0;
    }
  });
}

// Parse a stored block-height string to bigint, treating null/garbage as block 0 so callers can
// compare reconcile baselines without each guarding the try/catch (VEY-KANEO-461).
function safeBlockNumber(value: string | null): bigint {
  if (value === null) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function latestEventBlock(events: Array<{ blockNumber: string }>): string | null {
  let latest: bigint | null = null;
  for (const event of events) {
    try {
      const block = BigInt(event.blockNumber);
      latest = latest === null || block > latest ? block : latest;
    } catch {
      continue;
    }
  }

  return latest?.toString() ?? null;
}
