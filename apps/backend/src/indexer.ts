import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildingIds,
  defenseIds,
  shipIds,
  technologyIds
} from "./contractStateSchema";
import {
  decodeCompleteFleetMissionLogs,
  decodeDebrisFieldLog,
  decodeIndexedQueueCompletedLog,
  decodeIndexedQueueStartedLog,
  decodeMoonCreatedLog,
  decodeMoonChanceReportLog,
  decodePlanetSettledLog,
  decodePlanetRenamedLog,
  decodeRiftResourceLog,
  decodeSettledPlanetLog,
  decodeShipCountChangedLog,
  isDebrisFieldLog,
  isFleetMissionLog,
  isIndexedQueueCompletedLog,
  isIndexedQueueStartedLog,
  isMoonCreatedLog,
  isMoonChanceReportLog,
  isPlanetSettledLog,
  isPlanetRenamedLog,
  isRiftResourceLog,
  isSettledPlanetLog,
  isShipCountChangedLog,
  type ChainReader,
  type Address,
  type DebrisFieldEvent,
  type DefenseState,
  type FleetMissionVisibility,
  type FleetMissionSummary,
  type IndexedQueueCompletedEvent,
  type IndexedQueueStartedEvent,
  type IndexedMoonCreatedEvent,
  type IndexedRiftResourceEvent,
  type IndexedShipCountChangedEvent,
  type InfrastructureState,
  type ManagedPlanet,
  type MoonState,
  type MoonChanceReportEvent,
  type PlanetSettledEvent,
  type PlanetRenamedEvent,
  type PlayerQueues,
  type QueueState,
  type ResearchState,
  riftRequirements,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  type WalletPlanets
} from "./evm";
import {
  calculateIndexedHighscore,
  deriveBuildingRows,
  deriveDefenseRows,
  deriveShipRows,
  deriveTechnologyRows,
  zeroResources
} from "./readModels";
import type { HighscoreEntry } from "./highscores";
import { playerFallbackName, type PlayerProfile } from "./playerProfiles";

export type IndexedDebrisFieldEvent = DebrisFieldEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;
export type IndexedMoonChanceReportEvent = MoonChanceReportEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;

export type IndexerSnapshot = {
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
  safeToServeIndexedState: boolean;
  staleReason: string | null;
};

export type SettlementIndexerOptions = {
  database?: Database;
  databasePath?: string;
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

type ResourceColumns = {
  metal: string;
  crystal: string;
  deuterium: string;
};

type PlayerProfileRow = {
  display_name: string | null;
  updated_at: string | null;
  wallet: string;
};

export type IndexedRpcLog = RpcLog & {
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

export class SettlementIndexer {
  private readonly db: Database;
  private planetRebuildPromise: Promise<IndexerSnapshot> | null = null;
  private rebuildPromise: Promise<IndexerSnapshot> | null = null;

  constructor(
    private readonly chainReader: Pick<
      ChainReader,
      "listDebrisFieldEvents" | "listMoonChanceReportEvents" | "listSettledPlanetEvents"
    > & Pick<
      Partial<ChainReader>,
      "getDefenseState"
        | "getInfrastructureState"
        | "getPlayerQueues"
        | "getResearchState"
        | "getShipyardState"
        | "listCurrentPlanets"
    >,
    private readonly fromBlock: bigint,
    options: SettlementIndexerOptions = {}
  ) {
    this.db = options.database ?? openIndexerDatabase(options.databasePath ?? ":memory:");
    this.migrate();
  }

  snapshot(): IndexerSnapshot {
    const reconciliationInProgress = this.rebuildPromise !== null || this.planetRebuildPromise !== null;
    const staleReason = this.staleReason(reconciliationInProgress);
    const safeToServeIndexedState = !reconciliationInProgress && staleReason === null;
    return {
      indexedDebrisFields: this.count("indexed_debris_fields"),
      indexedEventLogs: this.count("indexed_event_logs"),
      indexedMoonChanceReports: this.count("indexed_moon_chance_reports"),
      indexedMoons: this.count("indexed_moons"),
      indexedPlanets: this.count("indexed_planets"),
      indexedState: safeToServeIndexedState ? "healthy" : reconciliationInProgress ? "reconciling" : "stale",
      indexedRiftBalances: this.count("indexed_rift_balances"),
      fromBlock: this.fromBlock.toString(),
      lastRebuiltAt: this.metadata("lastRebuiltAt"),
      lastReconciledAt: this.metadata("lastReconciledAt"),
      lastReconciledBlock: this.metadata("lastReconciledBlock"),
      lastReconciliationError: this.metadata("lastReconciliationError"),
      latestIndexedBlock: this.metadata("latestIndexedBlock"),
      pendingReconciliationReason: this.metadata("pendingReconciliationReason"),
      reconciliationInProgress,
      reorgDetectedAt: this.metadata("reorgDetectedAt"),
      safeToServeIndexedState,
      staleReason
    };
  }

  settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    return this.rows<SettledPlanetEvent>(
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
    return this.rows<SettledPlanetEvent>("SELECT event_json FROM contract_planets ORDER BY CAST(planet_id AS INTEGER) ASC");
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
    return row ? parseEvent<SettledPlanetEvent>(row.event_json) : null;
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

  walletSettlement(wallet: `0x${string}`): { wallet: `0x${string}`; hasFirstPlanet: boolean; homePlanetId: string | null; planet: SettledPlanetEvent | null; contractKind: "game" } {
    const planets = this.rows<SettledPlanetEvent>(
      "SELECT event_json FROM contract_planets WHERE lower(owner) = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
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
    const planets = this.rows<SettledPlanetEvent>(
      "SELECT event_json FROM contract_planets WHERE lower(owner) = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
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
    const summaries = this.indexedFleetMissionSummaries();

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      incoming: summaries.filter((mission) =>
        mission.owner.toLowerCase() !== walletLower
          && ownedPlanetIds.has(mission.targetPlanetId)
          && ["Attack", "AcsAttack", "Intercept", "MissileAttack"].includes(mission.missionType)
          && mission.status === "Outbound"
      ),
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
      )
    };
  }

  infrastructureRows(planetId: string): InfrastructureState["buildings"] {
    return deriveBuildingRows((id) => this.indexedLevel("contract_building_levels", "building_id", planetId, id));
  }

  shipRows(planetId: string): ShipyardState["ships"] {
    return deriveShipRows((id) => this.indexedLevel("contract_ship_counts", "ship_id", planetId, id));
  }

  defenseRows(planetId: string): DefenseState["defenses"] {
    return deriveDefenseRows((id) => this.indexedLevel("contract_defense_counts", "defense_id", planetId, id));
  }

  technologyLevels(wallet: `0x${string}`): Record<string, number> {
    const rows = this.db.query(`
      SELECT technology_id AS id, level AS value
      FROM contract_technology_levels
      WHERE owner = lower(?)
      ORDER BY technology_id ASC
    `).all(wallet) as LevelRow[];

    return Object.fromEntries(rows.map((row) => [String(row.id), row.value]));
  }

  technologyRows(wallet: `0x${string}`): ResearchState["technologies"] {
    const levels = this.technologyLevels(wallet);
    return deriveTechnologyRows((id) => levels[String(id)] ?? 0);
  }

  highscoreForWallet(wallet: `0x${string}`, planetIds?: string[]): HighscoreEntry {
    const settlement = this.walletSettlement(wallet);
    const ownedPlanets = (planetIds?.length
      ? planetIds.map((planetId) => this.planet(planetId)).filter((planet): planet is SettledPlanetEvent => (
        planet !== null && planet.owner.toLowerCase() === wallet.toLowerCase()
      ))
      : this.rows<SettledPlanetEvent>(
        "SELECT event_json FROM indexed_planets WHERE lower(owner) = lower(?) ORDER BY CAST(planet_id AS INTEGER) ASC",
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
    return [...planetsByOwner.keys()].map((owner) => this.highscoreForWallet(owner as `0x${string}`));
  }

  planetQueue(planetId: string, kind: "building" | "defense" | "ship"): QueueState | null {
    return this.queueState(`${kind}:${planetId}`);
  }

  moonQueue(planetId: string): QueueState | null {
    return this.queueState(`moon-building:${planetId}`);
  }

  researchQueue(wallet: `0x${string}`): QueueState | null {
    return this.queueState(`research:${wallet.toLowerCase()}`);
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
        level: planetId ? this.indexedLevel("indexed_moon_building_levels", "building_id", planetId, building.id) : 0,
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
          : "Build the Interdimensional Rift Stabilizer before using the Rift."
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

  applyLog(log: IndexedRpcLog): ApplyLogResult {
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

    this.recordLog(eventId, log);
    this.recordLatestBlock(log.blockNumber);

    if (log.removed) {
      this.markReorgDetected();
      this.markStale("removed log/reorg");
      return { applied: false, duplicate: false, ignored: false, removed: true, snapshot: this.snapshot() };
    }

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
    if (isIndexedQueueStartedLog(log)) {
      this.applyQueueStartedEvent(decodeIndexedQueueStartedLog(log));
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
    if (isFleetMissionLog(log)) {
      this.touch();
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }
    if (isMoonChanceReportLog(log)) {
      this.applyMoonChanceEvent(decodeMoonChanceReportLog(log));
      return { applied: true, duplicate: false, ignored: false, removed: false, snapshot: this.snapshot() };
    }

    return { applied: false, duplicate: false, ignored: true, removed: false, snapshot: this.snapshot() };
  }

  async rebuild(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }

    this.rebuildPromise = this.rebuildUncached()
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

  markStale(reason: string): IndexerSnapshot {
    this.setMetadata("pendingReconciliationReason", reason);
    return this.snapshot();
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

  private async rebuildUncached(): Promise<IndexerSnapshot> {
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
    const rebuild = this.db.transaction(() => {
      this.db.query("DELETE FROM indexed_planets").run();
      this.db.query("DELETE FROM indexed_debris_fields").run();
      this.db.query("DELETE FROM indexed_moon_chance_reports").run();
      this.clearCanonicalState();
      for (const event of planetEvents) {
        this.upsertPlanet(event);
      }
      this.applyCanonicalState(canonicalState);
      for (const event of debrisEvents) {
        this.upsertDebris(event);
      }
      for (const event of moonChanceEvents) {
        this.upsertMoonChanceReport(event);
      }
      const latestBlock = latestEventBlock([...settledPlanetEvents, ...debrisEvents, ...moonChanceEvents]);
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
    this.backfillCanonicalTables();
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

    this.db.query(`
      INSERT OR IGNORE INTO contract_building_levels (planet_id, building_id, level)
      SELECT planet_id, building_id, level FROM indexed_building_levels
    `).run();
    this.db.query(`
      INSERT OR IGNORE INTO contract_defense_counts (planet_id, defense_id, count)
      SELECT planet_id, defense_id, count FROM indexed_defense_counts
    `).run();
    this.db.query(`
      INSERT OR IGNORE INTO contract_ship_counts (planet_id, ship_id, count)
      SELECT planet_id, ship_id, count FROM indexed_ship_counts
    `).run();
    this.db.query(`
      INSERT OR IGNORE INTO contract_technology_levels (owner, technology_id, level)
      SELECT owner, technology_id, level FROM indexed_research_levels
    `).run();

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
    }

    this.db.query(`
      INSERT OR IGNORE INTO contract_highscore_inputs (wallet, home_planet_id, updated_at)
      SELECT wallet, home_planet_id, ?
      FROM contract_players
    `).run(now);
  }

  private async readCanonicalState(planets: SettledPlanetEvent[]): Promise<CanonicalReconciliationState> {
    const state: CanonicalReconciliationState = {
      planetQueues: new Map(),
      buildings: new Map(),
      defenses: new Map(),
      ships: new Map(),
      research: new Map(),
      researchQueues: new Map()
    };
    const owners = new Set(planets.map((planet) => planet.owner.toLowerCase() as `0x${string}`));

    await Promise.all(planets.map(async (planet) => {
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
        state.buildings.set(planetId, infrastructure.buildings);
        if (infrastructure.queue?.active) {
          state.planetQueues.set(`building:${planetId}`, infrastructure.queue);
        }
      }
      if (defenses) {
        state.defenses.set(planetId, defenses.defenses);
        if (defenses.queue?.active) {
          state.planetQueues.set(`defense:${planetId}`, defenses.queue);
        }
      }
      if (shipyard) {
        state.ships.set(planetId, shipyard.ships);
        if (shipyard.queue?.active) {
          state.planetQueues.set(`ship:${planetId}`, shipyard.queue);
        }
      }
      if (queues) {
        this.addActiveQueue(state.planetQueues, `building:${planetId}`, queues.building);
        this.addActiveQueue(state.planetQueues, `defense:${planetId}`, queues.defense);
        this.addActiveQueue(state.planetQueues, `ship:${planetId}`, queues.ship);
        this.addActiveResearchQueue(state.researchQueues, owner, queues.research);
      }
    }));

    await Promise.all([...owners].map(async (owner) => {
      const research = await this.chainReader.getResearchState?.(owner);
      if (!research) return;
      state.research.set(owner, research.technologies);
      this.addActiveResearchQueue(state.researchQueues, owner, research.queue);
    }));

    return state;
  }

  private clearCanonicalState(): void {
    this.db.query("DELETE FROM indexed_planet_queues").run();
    this.db.query("DELETE FROM indexed_building_levels").run();
    this.db.query("DELETE FROM indexed_defense_counts").run();
    this.db.query("DELETE FROM indexed_ship_counts").run();
    this.db.query("DELETE FROM indexed_research_levels").run();
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
  }

  private applyCanonicalState(state: CanonicalReconciliationState): void {
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
    for (const [key, queue] of state.planetQueues) {
      const [kind, planetId] = key.split(":");
      if (!kind || !planetId || !isPlanetQueueKind(kind)) continue;
      this.upsertCanonicalQueue(kind, planetId, null, queue);
    }
    for (const [owner, queue] of state.researchQueues) {
      this.upsertCanonicalQueue("research", null, owner, queue);
    }
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
      cost: queue.cost
    });
  }

  private upsertPlanet(event: SettledPlanetEvent): void {
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
      event.planetId,
      event.owner.toLowerCase(),
      event.galaxy,
      event.system,
      event.position,
      JSON.stringify(event)
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
      event.owner,
      event.planetId,
      JSON.stringify(event),
      new Date().toISOString(),
      event.owner,
      event.planetId
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
      event.planetId,
      event.owner,
      event.name,
      event.galaxy,
      event.system,
      event.position,
      event.fields,
      event.temperature,
      event.metalMultiplierBps,
      event.crystalMultiplierBps,
      event.deuteriumMultiplierBps,
      event.lastSettledAt,
      JSON.stringify(event)
    );
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
      event.planetId,
      event.resources.metal,
      event.resources.crystal,
      event.resources.deuterium,
      event.lastSettledAt,
      event.transactionHash,
      event.blockNumber
    );
  }

  private updatePlanetResources(event: PlanetSettledEvent): void {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(event.planetId) as EventRow | null;
    if (!row) return;

    const planet = parseEvent<SettledPlanetEvent>(row.event_json);
    this.upsertPlanet({
      ...planet,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      lastSettledAt: event.lastSettledAt,
      resources: event.resources
    });
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

  private applyQueueStartedEvent(event: IndexedQueueStartedEvent): void {
    this.upsertQueue(event);
    if (event.planetId) {
      this.subtractPlanetResources(event.planetId, event.cost, event.transactionHash, event.blockNumber);
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

  private applyQueueCompletedEvent(event: IndexedQueueCompletedEvent): void {
    this.db.query("DELETE FROM indexed_planet_queues WHERE queue_key = ?").run(queueKey(event));
    this.db.query("DELETE FROM contract_production_queues WHERE queue_key = ?").run(queueKey(event));
    if (event.queueKind === "building" && event.planetId && event.level !== undefined) {
      this.upsertIndexedLevel("indexed_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
      this.upsertIndexedLevel("contract_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
    } else if (event.queueKind === "moon-building" && event.planetId && event.level !== undefined) {
      this.upsertIndexedLevel("indexed_moon_building_levels", "building_id", "level", event.planetId, event.itemId, event.level);
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
    this.touch();
  }

  private upsertQueue(event: IndexedQueueStartedEvent): void {
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
      null,
      JSON.stringify(event.cost),
      JSON.stringify(event)
    );
    this.db.query(`
      INSERT INTO contract_production_queues (
        queue_key, queue_kind, planet_id, owner, item_id, target_level, quantity,
        ready_at, started_at, metal_cost, crystal_cost, deuterium_cost, event_json
      )
      VALUES (?, ?, ?, lower(?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      null,
      event.cost.metal,
      event.cost.crystal,
      event.cost.deuterium,
      JSON.stringify(event)
    );
  }

  private subtractPlanetResources(
    planetId: string,
    cost: IndexedQueueStartedEvent["cost"],
    transactionHash: string,
    blockNumber: string
  ): void {
    const row = this.db.query("SELECT event_json FROM contract_planets WHERE planet_id = ?").get(planetId) as EventRow | null;
    if (!row) return;

    const planet = parseEvent<SettledPlanetEvent>(row.event_json);
    this.upsertPlanet({
      ...planet,
      transactionHash,
      blockNumber,
      resources: subtractResources(planet.resources, cost)
    });
  }

  private queueState(queueKeyValue: string): QueueState | null {
    const row = this.db.query(`
      SELECT queue_kind, item_id, target_level, quantity, ready_at, started_at, metal_cost, crystal_cost, deuterium_cost
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

  private touch(): void {
    this.setMetadata("lastRebuiltAt", new Date().toISOString());
  }

  private recordLog(eventId: string, log: IndexedRpcLog): void {
    this.db.query(`
      INSERT INTO indexed_event_logs (event_id, transaction_hash, log_index, block_number, removed, event_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      log.transactionHash,
      log.logIndex ?? "0x0",
      blockNumberToDecimal(log.blockNumber),
      log.removed ? 1 : 0,
      JSON.stringify(log),
      new Date().toISOString()
    );
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

  private recordLatestBlock(blockNumber: string): void {
    this.setMetadata("latestIndexedBlock", blockNumberToDecimal(blockNumber));
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
    return decodeCompleteFleetMissionLogs(logs);
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

  private staleReason(reconciliationInProgress: boolean): string | null {
    if (reconciliationInProgress) return "reconciliation_in_progress";
    const error = this.metadata("lastReconciliationError");
    if (error) return `reconciliation_failed: ${error}`;
    const pending = this.metadata("pendingReconciliationReason");
    if (pending) return pending;
    if (!this.metadata("lastReconciledAt")) return "never_reconciled";
    return null;
  }
}

type CanonicalReconciliationState = {
  planetQueues: Map<string, QueueState>;
  buildings: Map<string, InfrastructureState["buildings"]>;
  defenses: Map<string, DefenseState["defenses"]>;
  ships: Map<string, ShipyardState["ships"]>;
  research: Map<`0x${string}`, ResearchState["technologies"]>;
  researchQueues: Map<`0x${string}`, QueueState>;
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
  return new Database(databasePath);
}

function parseEvent<T>(value: string): T {
  return JSON.parse(value) as T;
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
    fieldsUsed: buildings.filter((building) => building.level > 0).length,
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

function subtractResources(left: QueueState["cost"], right: QueueState["cost"]): QueueState["cost"] {
  return {
    metal: subtractResource(left.metal, right.metal),
    crystal: subtractResource(left.crystal, right.crystal),
    deuterium: subtractResource(left.deuterium, right.deuterium)
  };
}

function subtractResource(left: string, right: string): string {
  const result = BigInt(left) - BigInt(right);
  return result > 0n ? result.toString() : "0";
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

function blockNumberToDecimal(blockNumber: string): string {
  try {
    return BigInt(blockNumber).toString();
  } catch {
    return blockNumber;
  }
}

function subtractNonNegative(left: bigint, right: bigint): bigint {
  return left > right ? left - right : 0n;
}

function riftWithdrawalKey(event: IndexedRiftResourceEvent): string {
  return `${event.transactionHash.toLowerCase()}:${event.planetId}:${event.resourceId}:${event.amount}`;
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
