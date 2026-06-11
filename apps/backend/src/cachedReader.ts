import type {
  Address,
  AllianceIdentity,
  AllianceState,
  AttackProtectionStatus,
  BattleReport,
  ChainReader,
  DebrisFieldEvent,
  DefenseState,
  FleetMissionVisibility,
  InfrastructureState,
  WalletPlanets,
  MoonState,
  MoonChanceReportEvent,
  PlanetState,
  PlayerQueues,
  ResearchState,
  RiftState,
  RpcLog,
  RpcMetrics,
  SettledPlanetEvent,
  SettlementFundingState,
  ShipyardState,
  WalletSettlement
} from "./evm";
import type { HighscoreEntry } from "./highscores";

type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

export class CachedChainReader implements ChainReader {
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly inner: ChainReader,
    private readonly ttlMs = 2_000
  ) {}

  clear(): void {
    this.cache.clear();
  }

  getWalletSettlement(wallet: Address): Promise<WalletSettlement> {
    return this.cached(`settlement:${wallet.toLowerCase()}`, () => this.inner.getWalletSettlement(wallet));
  }

  getSettlementFunding(wallet: Address): Promise<SettlementFundingState> {
    return this.cached(`settlement-funding:${wallet.toLowerCase()}`, () => this.inner.getSettlementFunding(wallet));
  }

  getWalletPlanets(wallet: Address): Promise<WalletPlanets> {
    return this.cached(`planets:${wallet.toLowerCase()}`, () => this.inner.getWalletPlanets(wallet));
  }

  getPlanet(planetId: bigint): Promise<PlanetState | null> {
    return this.cached(`planet:${planetId.toString()}`, () => this.inner.getPlanet(planetId));
  }

  getPlayerQueues(wallet: Address, planetId?: bigint): Promise<PlayerQueues> {
    return this.cached(`queues:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getPlayerQueues(wallet, planetId));
  }

  getInfrastructureState(wallet: Address, planetId?: bigint): Promise<InfrastructureState> {
    return this.cached(`infrastructure:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getInfrastructureState(wallet, planetId));
  }

  getInfrastructureAuthoritativeFields(planetId: bigint): Promise<Partial<Pick<InfrastructureState, "buildings" | "resources">>> {
    if (!this.inner.getInfrastructureAuthoritativeFields) {
      return Promise.resolve({});
    }

    return this.cached(
      `infrastructure-authoritative:${planetId.toString()}`,
      () => this.inner.getInfrastructureAuthoritativeFields!(planetId)
    );
  }

  getFleetMissionVisibility(wallet: Address): Promise<FleetMissionVisibility> {
    return this.cached(`fleet-visibility:${wallet.toLowerCase()}`, () => this.inner.getFleetMissionVisibility(wallet));
  }

  getBattleReport(missionId: bigint): Promise<BattleReport | null> {
    return this.cached(`battle-report:${missionId.toString()}`, () => this.inner.getBattleReport(missionId));
  }

  listBattleReports(): Promise<BattleReport[]> {
    return this.cached("battle-reports", () => this.inner.listBattleReports());
  }

  getMoonState(wallet: Address, planetId?: bigint): Promise<MoonState> {
    return this.cached(`moon:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getMoonState(wallet, planetId));
  }

  getDefenseState(wallet: Address, planetId?: bigint): Promise<DefenseState> {
    return this.cached(`defenses:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getDefenseState(wallet, planetId));
  }

  getShipyardState(wallet: Address, planetId?: bigint): Promise<ShipyardState> {
    return this.cached(`shipyard:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getShipyardState(wallet, planetId));
  }

  getShipyardAuthoritativeFields(
    planetId: bigint,
    maxTemperature?: number
  ): Promise<Partial<Pick<ShipyardState, "naniteLevel" | "resources" | "ships" | "shipyardLevel">>> {
    if (!this.inner.getShipyardAuthoritativeFields) {
      return Promise.resolve({});
    }

    return this.cached(
      `shipyard-authoritative:${planetId.toString()}:${maxTemperature ?? "unknown"}`,
      () => this.inner.getShipyardAuthoritativeFields!(planetId, maxTemperature)
    );
  }

  getResearchState(wallet: Address, planetId?: bigint): Promise<ResearchState> {
    return this.cached(`research:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getResearchState(wallet, planetId));
  }

  getRiftState(wallet: Address, planetId?: bigint): Promise<RiftState> {
    return this.cached(`rift:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getRiftState(wallet, planetId));
  }

  getAllianceState(wallet: Address): Promise<AllianceState> {
    return this.cached(`alliance:${wallet.toLowerCase()}`, () => this.inner.getAllianceState(wallet));
  }

  getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
    if (!this.inner.getAllianceIntelForPlayers) {
      return Promise.resolve(new Map());
    }

    const normalizedWallets = Array.from(new Set(wallets.map((wallet) => wallet.toLowerCase() as Address))).sort();
    return this.cached(
      `alliance-intel:${normalizedWallets.join(",")}`,
      () => this.inner.getAllianceIntelForPlayers!(normalizedWallets)
    );
  }

  listAllianceDirectoryState(): Promise<AllianceState["directory"]> {
    if (!this.inner.listAllianceDirectoryState) {
      return Promise.resolve([]);
    }

    return this.cached("alliance-directory", () => this.inner.listAllianceDirectoryState!());
  }

  getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus> {
    return this.cached(
      `attack-protection:${wallet.toLowerCase()}:${targetPlanetId.toString()}`,
      () => this.inner.getAttackProtectionStatus(wallet, targetPlanetId)
    );
  }

  getHighscoreForWallet(wallet: Address, planetIds?: string[]): Promise<HighscoreEntry> {
    if (!this.inner.getHighscoreForWallet) {
      return Promise.reject(new Error("Highscores are not supported by the wrapped chain reader."));
    }

    const planetScope = planetIds?.length ? planetIds.join(",") : "indexed";
    return this.cached(
      `highscore:${wallet.toLowerCase()}:${planetScope}`,
      () => this.inner.getHighscoreForWallet!(wallet, planetIds)
    );
  }

  getHighscoresForWallets(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): Promise<HighscoreEntry[]> {
    if (!this.inner.getHighscoresForWallets) {
      return Promise.reject(new Error("Bulk highscores are not supported by the wrapped chain reader."));
    }

    const scope = [...planetsByOwner.entries()]
      .map(([owner, planets]) => `${owner}:${planets.map((planet) => planet.planetId).join(",")}`)
      .join("|");
    return this.cached(`highscores:${scope}`, () => this.inner.getHighscoresForWallets!(planetsByOwner));
  }

  listSettledPlanetEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<SettledPlanetEvent[]> {
    return this.inner.listSettledPlanetEvents(fromBlock, toBlock);
  }

  listCurrentPlanets(): Promise<SettledPlanetEvent[]> {
    if (!this.inner.listCurrentPlanets) {
      return Promise.reject(new Error("Current planet enumeration is not supported by the wrapped chain reader."));
    }

    return this.cached("current-planets", () => this.inner.listCurrentPlanets!());
  }

  listMoonChanceReportEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<MoonChanceReportEvent[]> {
    return this.inner.listMoonChanceReportEvents(fromBlock, toBlock);
  }

  listDebrisFieldEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<DebrisFieldEvent[]> {
    return this.inner.listDebrisFieldEvents(fromBlock, toBlock);
  }

  listAllianceLogs(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]> {
    if (!this.inner.listAllianceLogs) {
      return Promise.resolve([]);
    }

    return this.inner.listAllianceLogs(fromBlock, toBlock);
  }

  listContractLogs(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]> {
    if (!this.inner.listContractLogs) {
      return Promise.resolve([]);
    }

    return this.inner.listContractLogs(fromBlock, toBlock);
  }

  rpcMetrics(): RpcMetrics {
    return this.inner.rpcMetrics?.() ?? {
      batchRequests: 0,
      callsByMethod: {},
      httpRequests: 0,
      timeouts: 0
    };
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const current = this.cache.get(key);
    if (current && current.expiresAt > now) {
      return current.value as Promise<T>;
    }

    const value = load().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, {
      expiresAt: now + this.ttlMs,
      value
    });
    return value;
  }
}
