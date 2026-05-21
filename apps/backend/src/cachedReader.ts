import type {
  Address,
  AllianceState,
  AttackProtectionStatus,
  ChainReader,
  DebrisFieldEvent,
  DefenseState,
  FleetMissionVisibility,
  InfrastructureState,
  WalletPlanets,
  MoonState,
  PlanetState,
  PlayerQueues,
  ResearchState,
  RiftState,
  RpcMetrics,
  SettledPlanetEvent,
  ShipyardState,
  WalletSettlement
} from "./evm";

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

  getFleetMissionVisibility(wallet: Address): Promise<FleetMissionVisibility> {
    return this.cached(`fleet-visibility:${wallet.toLowerCase()}`, () => this.inner.getFleetMissionVisibility(wallet));
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

  getResearchState(wallet: Address, planetId?: bigint): Promise<ResearchState> {
    return this.cached(`research:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getResearchState(wallet, planetId));
  }

  getRiftState(wallet: Address, planetId?: bigint): Promise<RiftState> {
    return this.cached(`rift:${wallet.toLowerCase()}:${planetId?.toString() ?? "home"}`, () => this.inner.getRiftState(wallet, planetId));
  }

  getAllianceState(wallet: Address): Promise<AllianceState> {
    return this.cached(`alliance:${wallet.toLowerCase()}`, () => this.inner.getAllianceState(wallet));
  }

  getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus> {
    return this.cached(
      `attack-protection:${wallet.toLowerCase()}:${targetPlanetId.toString()}`,
      () => this.inner.getAttackProtectionStatus(wallet, targetPlanetId)
    );
  }

  listSettledPlanetEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<SettledPlanetEvent[]> {
    return this.inner.listSettledPlanetEvents(fromBlock, toBlock);
  }

  listDebrisFieldEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<DebrisFieldEvent[]> {
    return this.inner.listDebrisFieldEvents(fromBlock, toBlock);
  }

  rpcMetrics(): RpcMetrics {
    return this.inner.rpcMetrics?.() ?? {
      batchRequests: 0,
      callsByMethod: {},
      httpRequests: 0
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
