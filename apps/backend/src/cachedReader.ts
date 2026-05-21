import type {
  Address,
  ChainReader,
  DefenseState,
  InfrastructureState,
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

  getPlanet(planetId: bigint): Promise<PlanetState | null> {
    return this.cached(`planet:${planetId.toString()}`, () => this.inner.getPlanet(planetId));
  }

  getPlayerQueues(wallet: Address): Promise<PlayerQueues> {
    return this.cached(`queues:${wallet.toLowerCase()}`, () => this.inner.getPlayerQueues(wallet));
  }

  getInfrastructureState(wallet: Address): Promise<InfrastructureState> {
    return this.cached(`infrastructure:${wallet.toLowerCase()}`, () => this.inner.getInfrastructureState(wallet));
  }

  getMoonState(wallet: Address): Promise<MoonState> {
    return this.cached(`moon:${wallet.toLowerCase()}`, () => this.inner.getMoonState(wallet));
  }

  getDefenseState(wallet: Address): Promise<DefenseState> {
    return this.cached(`defenses:${wallet.toLowerCase()}`, () => this.inner.getDefenseState(wallet));
  }

  getShipyardState(wallet: Address): Promise<ShipyardState> {
    return this.cached(`shipyard:${wallet.toLowerCase()}`, () => this.inner.getShipyardState(wallet));
  }

  getResearchState(wallet: Address): Promise<ResearchState> {
    return this.cached(`research:${wallet.toLowerCase()}`, () => this.inner.getResearchState(wallet));
  }

  getRiftState(wallet: Address): Promise<RiftState> {
    return this.cached(`rift:${wallet.toLowerCase()}`, () => this.inner.getRiftState(wallet));
  }

  listSettledPlanetEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<SettledPlanetEvent[]> {
    return this.inner.listSettledPlanetEvents(fromBlock, toBlock);
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
