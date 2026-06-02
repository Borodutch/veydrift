import type { BackendConfig } from "./config";
import { calculateHighscore, type HighscoreEntry } from "./highscores";
import type { Coordinates } from "./universe";
import { planetMetadata, planetMultipliers } from "./universe";

export type Address = `0x${string}`;

export type Resources = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export type EnergyBalance = {
  produced: string;
  required: string;
  scaleBps: string;
};

export type PlanetState = Coordinates & {
  planetId: string;
  owner: Address;
  name: string | null;
  fields: number;
  temperature: number;
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
  lastSettledAt: string;
  resources: Resources;
};

export type ManagedPlanet = PlanetState & {
  coordinates: string;
  isHomePlanet: boolean;
  fieldsUsed: number;
  fieldsCapacity: number;
  keyLevels: {
    metalMine: number;
    crystalMine: number;
    deuteriumSynthesizer: number;
    solarPlant: number;
    roboticsFactory: number;
    shipyard: number;
    researchLab: number;
    terraformer: number;
  };
  queues: {
    building: QueueState | null;
    defense: QueueState | null;
    ship: QueueState | null;
  };
  moon: {
    exists: boolean;
  } | null;
};

export type WalletPlanets = {
  wallet: Address;
  homePlanetId: string | null;
  queues?: {
    research: QueueState | null;
  };
  planets: ManagedPlanet[];
};

export type WalletSettlement = {
  wallet: Address;
  hasFirstPlanet: boolean;
  homePlanetId: string | null;
  planet: PlanetState | null;
  contractKind?: "game" | "settlement";
};

export type QueueState = {
  active: boolean;
  kind: string | null;
  itemId?: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string | null;
  startedAt?: string | null;
  cost: Resources;
};

export type PlayerQueues = {
  wallet: Address;
  homePlanetId: string | null;
  building: QueueState | null;
  defense: QueueState | null;
  ship: QueueState | null;
  research: QueueState | null;
};

export type IndexedQueueStartedEvent = {
  eventName: "BuildingStarted" | "DefenseQueued" | "ShipQueued" | "ResearchQueued" | "MoonBuildingStarted";
  transactionHash: string;
  blockNumber: string;
  queueKind: "building" | "defense" | "ship" | "research" | "moon-building";
  planetId?: string;
  owner?: Address;
  itemId: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string;
  startedAt?: string;
  cost: Resources;
};

export type IndexedQueueCompletedEvent = {
  eventName: "BuildingCompleted" | "DefenseCompleted" | "ShipCompleted" | "ResearchCompleted" | "MoonBuildingCompleted";
  transactionHash: string;
  blockNumber: string;
  queueKind: "building" | "defense" | "ship" | "research" | "moon-building";
  planetId?: string;
  owner?: Address;
  itemId: number;
  level?: number;
  quantity?: number;
  total?: number;
};

export type IndexedMoonCreatedEvent = {
  eventName: "MoonCreated";
  transactionHash: string;
  blockNumber: string;
  owner: Address;
  planetId: string;
  galaxy: number;
  system: number;
  position: number;
  fields: number;
  diameterKm: number;
  createdAt: string;
};

export type IndexedRiftResourceEvent = {
  eventName: "MarketResourceDeposited" | "MarketResourceWithdrawalRequested" | "MarketResourceWithdrawalFinished";
  transactionHash: string;
  blockNumber: string;
  owner: Address;
  planetId: string;
  resourceId: number;
  amount: string;
  unlocksAt?: string;
};

export type IndexedShipCountChangedEvent = {
  eventName: "PlanetShipCountChanged";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  shipId: number;
  total: number;
};

export type FleetMissionVisibility = {
  wallet: Address;
  homePlanetId: string | null;
  incoming: FleetMissionSummary[];
  outgoing: FleetMissionSummary[];
  returning: FleetMissionSummary[];
  joinableAttacks: FleetMissionSummary[];
};

export type FleetMissionSummary = {
  missionId: string;
  status: string;
  missionType: string;
  owner: Address;
  originPlanetId: string;
  targetPlanetId: string;
  arrivalAt: string;
  returnAt: string;
  fuelCost: string;
  recallCost: string | null;
  attackGroupId: string | null;
  joinedAttackMissionIds: string[];
  cargo: Resources;
  ships: Record<string, string>;
  transactionHash: string;
  blockNumber: string;
  needsResolution: boolean;
};

export type ResolvableFleetMission = Pick<
  FleetMissionSummary,
  "arrivalAt" | "missionId" | "missionType" | "originPlanetId" | "targetPlanetId"
>;

export type ShipyardState = {
  wallet: Address;
  homePlanetId: string | null;
  productionAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  fleetSlots: {
    active: number;
    limit: number;
  };
  shipyardLevel: number;
  naniteLevel: number;
  technologyLevels: Record<string, number>;
  ships: Array<{
    id: number;
    count: number;
    cost: Resources;
  }>;
  queue: QueueState | null;
};

export type DefenseState = {
  wallet: Address;
  homePlanetId: string | null;
  productionAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  shipyardLevel: number;
  missileSiloLevel: number;
  technologyLevels: Record<string, number>;
  defenses: Array<{
    id: number;
    count: number;
    cost: Resources;
  }>;
  queue: QueueState | null;
};

export type InfrastructureState = {
  wallet: Address;
  homePlanetId: string | null;
  infrastructureAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  productionPerHour: Resources | null;
  energyBalance: EnergyBalance | null;
  storageCaps: Resources | null;
  protectedResources: Resources | null;
  raidableResources: Resources | null;
  technologyLevels: Record<string, number>;
  buildings: Array<{
    id: number;
    level: number;
    cost: Resources;
  }>;
  queue: QueueState | null;
};

export type MoonState = {
  wallet: Address;
  homePlanetId: string | null;
  moonAvailable: boolean;
  unavailableReason?: string;
  moon: {
    exists: boolean;
    planetId: string;
    owner: Address;
    fields: number;
    diameterKm: number;
    createdAt: string;
    jumpGateReadyAt: string;
  } | null;
  buildings: Array<{
    id: number;
    key: string;
    label: string;
    level: number;
    cost: Resources;
  }>;
  queue: QueueState | null;
};

export type ResearchState = {
  wallet: Address;
  homePlanetId: string | null;
  researchAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  researchLabLevel: number;
  researchNetworkLabLevels: number[];
  technologyLevels: Record<string, number>;
  technologies: Array<{
    id: number;
    level: number;
    cost: Resources;
  }>;
  queue: QueueState | null;
};

export type RiftResourceKey = "metal" | "crystal" | "deuterium";

export type RiftRequirement = {
  kind: "building" | "technology";
  key: string;
  label: string;
  currentLevel: number | null;
  requiredLevel: number;
  binary?: boolean;
  built?: boolean | null;
};

export type RiftResourceState = {
  key: RiftResourceKey;
  label: string;
  resourceId: number;
  tokenAddress: Address | null;
  walletBalance: string | null;
  allowance: string | null;
  inGameBalance: string;
  lockedBalance: string;
};

export type PendingWithdrawal = {
  id: string;
  resource: RiftResourceKey;
  amount: string;
  requestedAt: string;
  unlocksAt: string;
  ready: boolean;
};

export type RiftState = {
  wallet: Address;
  homePlanetId: string | null;
  riftAvailable: boolean;
  unlocked: boolean;
  unavailableReason?: string;
  withdrawalDelaySeconds: string;
  requirements: RiftRequirement[];
  resources: RiftResourceState[];
  pendingWithdrawals: PendingWithdrawal[];
};

export type AllianceState = {
  wallet: Address;
  allianceAvailable: boolean;
  unavailableReason?: string;
  membership: {
    allianceId: string;
    role: AllianceRoleName;
    joinedAt: string;
  };
  profile: {
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: Address;
    ownerDisplayName?: string | null;
    createdAt: string;
    memberCount: number;
  } | null;
  directory: Array<{
    allianceId: string;
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: Address;
    ownerDisplayName?: string | null;
    createdAt: string;
    memberCount: number;
  }>;
  pendingInvites: Array<{
    allianceId: string;
    inviter: Address;
    inviterDisplayName?: string | null;
    invitedAt: string;
  }>;
  pendingJoinRequests: Array<{
    allianceId: string;
    requester: Address;
    requesterDisplayName?: string | null;
    requestedAt: string;
  }>;
  allianceJoinRequests: Array<{
    allianceId: string;
    requester: Address;
    requesterDisplayName?: string | null;
    requestedAt: string;
  }>;
  members: Array<{
    address: Address;
    displayName?: string | null;
    role: AllianceRoleName;
    joinedAt: string;
  }>;
};

type AllianceRoleName = "none" | "member" | "officer" | "owner";

export type AttackBlockReason = "none" | "bashing_limit" | "score_protection" | "same_alliance";
export type AttackRelation = "peer" | "stronger" | "weaker";
export type HonorStatus = "neutral" | "honorable" | "bandit";

export type AttackProtectionStatus = {
  wallet: Address;
  targetPlanetId: string;
  allowed: boolean;
  blockedReason: AttackBlockReason;
  blockedReasonLabel: string | null;
  relation: AttackRelation;
  defenderHonorStatus: HonorStatus;
  plunderBps: number;
  defenderInactive: boolean;
};

export type AllianceIdentity = {
  allianceId: string;
  tag: string;
  name: string;
};

export type SettledPlanetEvent = PlanetState & {
  eventName: "PlanetStarted" | "ColonyCreated";
  transactionHash: string;
  blockNumber: string;
};

export type PlanetSettledEvent = {
  eventName: "PlanetSettled";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  lastSettledAt: string;
  resources: Resources;
};

export type PlanetRenamedEvent = {
  eventName: "PlanetRenamed";
  transactionHash: string;
  blockNumber: string;
  owner: Address;
  planetId: string;
  name: string;
};

export type MoonChanceReportEvent = {
  eventName:
    | "MoonChanceRequested"
    | "MoonChanceFinalized"
    | "MoonChanceSkippedExistingMoon"
    | "MoonDestructionRequested"
    | "MoonDestructionFinalized";
  transactionHash: string;
  blockNumber: string;
  battleId: string;
  targetPlanetId: string;
  outcomeId?: string;
  defender?: Address;
  attacker?: Address;
  metalDebris?: string;
  crystalDebris?: string;
  chanceBps?: number;
  deathstars?: number;
  moonDestructionChanceBps?: number;
  deathstarDestructionChanceBps?: number;
  randomnessRequestId?: string;
  purposeHash?: string;
  moonCreated?: boolean;
  moonDestroyed?: boolean;
  deathstarsDestroyed?: boolean;
  randomWord?: string;
  moonFields?: number;
  moonDiameterKm?: number;
};

export type DebrisFieldEvent = {
  eventName: "DebrisFieldUpdated";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  resources: {
    metal: string;
    crystal: string;
  };
};

export interface ChainReader {
  getWalletSettlement(wallet: Address): Promise<WalletSettlement>;
  getWalletPlanets(wallet: Address): Promise<WalletPlanets>;
  getPlanet(planetId: bigint): Promise<PlanetState | null>;
  getPlayerQueues(wallet: Address, planetId?: bigint): Promise<PlayerQueues>;
  getFleetMissionVisibility(wallet: Address): Promise<FleetMissionVisibility>;
  getInfrastructureState(wallet: Address, planetId?: bigint): Promise<InfrastructureState>;
  getMoonState(wallet: Address, planetId?: bigint): Promise<MoonState>;
  getDefenseState(wallet: Address, planetId?: bigint): Promise<DefenseState>;
  getShipyardState(wallet: Address, planetId?: bigint): Promise<ShipyardState>;
  getResearchState(wallet: Address, planetId?: bigint): Promise<ResearchState>;
  getRiftState(wallet: Address, planetId?: bigint): Promise<RiftState>;
  getAllianceState(wallet: Address): Promise<AllianceState>;
  getAllianceIntelForPlayers?(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>>;
  getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus>;
  getHighscoreForWallet?(wallet: Address, planetIds?: string[]): Promise<HighscoreEntry>;
  getHighscoresForWallets?(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): Promise<HighscoreEntry[]>;
  listCurrentPlanets?(): Promise<SettledPlanetEvent[]>;
  listResolvableFleetMissions?(): Promise<ResolvableFleetMission[]>;
  listSettledPlanetEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<SettledPlanetEvent[]>;
  listMoonChanceReportEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<MoonChanceReportEvent[]>;
  listDebrisFieldEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<DebrisFieldEvent[]>;
  rpcMetrics?(): RpcMetrics;
}

export type RpcMetrics = {
  batchRequests: number;
  callsByMethod: Record<string, number>;
  httpRequests: number;
};

type RpcCacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

export type RpcLog = {
  blockNumber: string;
  transactionHash: string;
  topics: string[];
  data: string;
};

type RpcLogFilter = {
  address: Address;
  fromBlock: string;
  toBlock: string;
  topics: Array<string | string[] | null>;
};

export type RpcBlock = {
  timestamp: string;
};

export class HttpJsonRpcTransport {
  private readonly metrics: RpcMetrics = {
    batchRequests: 0,
    callsByMethod: {},
    httpRequests: 0
  };
  private readonly cache = new Map<string, RpcCacheEntry<unknown>>();
  private readonly cacheTtlMs: number;
  private readonly minRequestIntervalMs: number;
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rpcUrl: string,
    options: { cacheTtlMs?: number; minRequestIntervalMs?: number } = {}
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 2_000;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 300;
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    this.countRpc(method);
    const cacheKey = this.cacheKey(method, params);
    if (cacheKey) {
      return this.cached(cacheKey, () => this.requestUncached<T>(method, params));
    }

    return this.requestUncached<T>(method, params);
  }

  private async requestUncached<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.metrics.httpRequests += 1;
      const response = await this.fetchRpc({
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params
        })
      });

      if (!response.ok) {
        if (isRetryableRpcHttpStatus(response.status) && attempt < 2) {
          await retryDelay(attempt);
          continue;
        }
        throw new Error(`RPC HTTP ${response.status}`);
      }

      const body = (await response.json()) as JsonRpcResponse<T>;
      if (body.error) {
        if (isRetryableRpcError(body.error) && attempt < 2) {
          await retryDelay(attempt);
          continue;
        }
        throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
      }

      if (body.result === undefined) {
        throw new Error("RPC response missing result.");
      }

      return body.result;
    }

    throw new Error("RPC request failed after retries.");
  }

  async requestBatch<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (requests.length === 0) {
      return [];
    }

    for (const request of requests) {
      this.countRpc(request.method);
    }
    const cacheMisses = new Map<string, {
      deferred: Deferred<T>;
      request: { method: string; params: unknown[] };
    }>();
    const resultPromises = requests.map((request) => {
      const cacheKey = this.cacheKey(request.method, request.params);
      if (!cacheKey) return null;

      const cached = this.cachedValue<T>(cacheKey);
      if (cached) return cached;

      const existingMiss = cacheMisses.get(cacheKey);
      if (existingMiss) return existingMiss.deferred.promise;

      const deferred = createDeferred<T>();
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        value: deferred.promise
      });
      cacheMisses.set(cacheKey, { deferred, request });
      return deferred.promise;
    });
    const uncachedRequests = requests
      .map((request, index) => ({ index, request }))
      .filter(({ index }) => resultPromises[index] === null);

    if (cacheMisses.size > 0) {
      const misses = [...cacheMisses.entries()];
      this.requestBatchUncached<T>(misses.map(([, miss]) => miss.request))
        .then((results) => {
          results.forEach((result, index) => {
            misses[index]?.[1].deferred.resolve(result);
          });
        })
        .catch((error) => {
          for (const [cacheKey, miss] of misses) {
            this.cache.delete(cacheKey);
            miss.deferred.reject(error);
          }
        });
    }

    if (uncachedRequests.length > 0) {
      const uncachedPromise = this.requestBatchUncached<T>(uncachedRequests.map(({ request }) => request));
      uncachedRequests.forEach(({ index }, resultIndex) => {
        resultPromises[index] = uncachedPromise.then((results) => {
          const result = results[resultIndex];
          if (result === undefined) {
            throw new Error("RPC batch response missing item.");
          }
          return result;
        });
      });
    }

    return Promise.all(resultPromises as Array<Promise<T>>);
  }

  private async requestBatchUncached<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.metrics.batchRequests += 1;
      this.metrics.httpRequests += 1;

      const response = await this.fetchRpc({
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(requests.map((request, index) => ({
          jsonrpc: "2.0",
          id: index + 1,
          method: request.method,
          params: request.params
        })))
      });

      if (!response.ok) {
        if (isRetryableRpcHttpStatus(response.status) && attempt < 2) {
          await retryDelay(attempt);
          continue;
        }
        throw new Error(`RPC HTTP ${response.status}`);
      }

      const body = await response.json() as JsonRpcResponse<T> | Array<JsonRpcResponse<T> & { id?: number }>;
      if (!Array.isArray(body)) {
        if (body.error && isRetryableRpcError(body.error) && attempt < 2) {
          await retryDelay(attempt);
          continue;
        }
        if (body.error) {
          throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
        }
        throw new Error("RPC batch response missing items.");
      }

      const bodies = body;
      const retryableError = bodies.find((body) => body.error && isRetryableRpcError(body.error));
      if (retryableError?.error && attempt < 2) {
        await retryDelay(attempt);
        continue;
      }
      const byId = new Map(bodies.map((body) => [body.id, body]));

      return requests.map((_, index) => {
        const body = byId.get(index + 1);
        if (!body) {
          throw new Error("RPC batch response missing item.");
        }
        if (body.error) {
          throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
        }
        if (body.result === undefined) {
          throw new Error("RPC response missing result.");
        }
        return body.result;
      });
    }

    throw new Error("RPC batch request failed after retries.");
  }

  snapshot(): RpcMetrics {
    return {
      batchRequests: this.metrics.batchRequests,
      callsByMethod: { ...this.metrics.callsByMethod },
      httpRequests: this.metrics.httpRequests
    };
  }

  private countRpc(method: string): void {
    this.metrics.callsByMethod[method] = (this.metrics.callsByMethod[method] ?? 0) + 1;
  }

  private fetchRpc(init: RequestInit): Promise<Response> {
    const scheduled = this.requestQueue.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      if (waitMs > 0) {
        await retryDelayMs(waitMs);
      }
      this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
      return fetch(this.rpcUrl, init);
    });
    this.requestQueue = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.cachedValue<T>(key);
    if (current) return current;

    const value = load().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value
    });
    return value;
  }

  private cachedValue<T>(key: string): Promise<T> | null {
    const current = this.cache.get(key);
    if (!current) return null;
    if (current.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return current.value as Promise<T>;
  }

  private cacheKey(method: string, params: unknown[]): string | null {
    if (!isCacheableRpcMethod(method)) return null;
    return `${method}:${JSON.stringify(params)}`;
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function isCacheableRpcMethod(method: string): boolean {
  return method === "eth_call"
    || method === "eth_getLogs"
    || method === "eth_blockNumber"
    || method === "eth_getBlockByNumber";
}

export class VeydriftGameReader implements ChainReader {
  private readonly transport: Pick<HttpJsonRpcTransport, "request"> & Partial<Pick<HttpJsonRpcTransport, "requestBatch" | "snapshot">>;
  private readonly gameContractAddress: Address;
  private readonly allianceContractAddress: Address | undefined;
  private readonly moonContractAddress: Address | undefined;
  private readonly chainId: number;
  private readonly indexFromBlock: bigint;
  private readonly resourceTokenAddresses: Partial<Record<RiftResourceKey, Address>>;
  private readonly settlementContractAddress: Address | undefined;

  constructor(
    config: BackendConfig,
    transport?: Pick<HttpJsonRpcTransport, "request"> & Partial<Pick<HttpJsonRpcTransport, "requestBatch" | "snapshot">>
  ) {
    if (!config.rpcUrl) {
      throw new Error("RPC URL is required.");
    }
    if (!config.gameContractAddress) {
      throw new Error("VeydriftGame contract address is required.");
    }

    this.transport = transport ?? new HttpJsonRpcTransport(config.rpcUrl);
    this.allianceContractAddress = config.allianceContractAddress;
    this.gameContractAddress = config.gameContractAddress;
    this.moonContractAddress = config.moonContractAddress;
    this.chainId = config.chainId;
    this.indexFromBlock = config.indexFromBlock;
    this.resourceTokenAddresses = config.resourceTokenAddresses ?? {};
    this.settlementContractAddress = config.settlementContractAddress;
  }

  rpcMetrics(): RpcMetrics {
    return this.transport.snapshot?.() ?? {
      batchRequests: 0,
      callsByMethod: {},
      httpRequests: 0
    };
  }

  async getWalletSettlement(wallet: Address): Promise<WalletSettlement> {
    assertAddress(wallet);
    try {
      return await this.getGameSettlement(wallet);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return this.getCompactSettlement(wallet);
    }
  }

  async getPlanet(planetId: bigint): Promise<PlanetState | null> {
    const words = splitWords(await this.call("0x181c1bc4", [encodeUint(planetId)]));
    const owner = decodeAddressWord(wordAt(words, 0));
    if (owner === zeroAddress) {
      return null;
    }
    const name = await this.readPlanetName(planetId);

    return {
      planetId: planetId.toString(),
      owner,
      name,
      galaxy: Number(decodeUintWord(wordAt(words, 1))),
      system: Number(decodeUintWord(wordAt(words, 2))),
      position: Number(decodeUintWord(wordAt(words, 3))),
      fields: Number(decodeUintWord(wordAt(words, 4))),
      temperature: Number(decodeSignedWord(wordAt(words, 5))),
      metalMultiplierBps: Number(decodeUintWord(wordAt(words, 6))),
      crystalMultiplierBps: Number(decodeUintWord(wordAt(words, 7))),
      deuteriumMultiplierBps: Number(decodeUintWord(wordAt(words, 8))),
      lastSettledAt: decodeUintWord(wordAt(words, 9)).toString(),
      resources: decodeResources(words.slice(10, 13))
    };
  }

  async getWalletPlanets(wallet: Address): Promise<WalletPlanets> {
    assertAddress(wallet);
    const settlement = await this.getGameSettlement(wallet);
    const events = await this.listSettledPlanetEvents(this.indexFromBlock, "latest");
    const ids = new Set<string>();
    if (settlement.homePlanetId) ids.add(settlement.homePlanetId);
    for (const event of events) {
      if (event.owner.toLowerCase() === wallet.toLowerCase()) ids.add(event.planetId);
    }

    const planets = (await Promise.all(
      [...ids].map(async (id) => {
        const planet = await this.getPlanet(BigInt(id));
        if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) return null;
        return this.readManagedPlanet(planet, settlement.homePlanetId);
      })
    )).filter((planet): planet is ManagedPlanet => planet !== null);

    planets.sort((left, right) => {
      if (left.isHomePlanet !== right.isHomePlanet) return left.isHomePlanet ? -1 : 1;
      return Number(BigInt(left.planetId) - BigInt(right.planetId));
    });

    const research = await this.readResearchQueue(wallet);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      queues: { research },
      planets
    };
  }

  async getPlayerQueues(wallet: Address, selectedPlanetId?: bigint): Promise<PlayerQueues> {
    const settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        building: null,
        defense: null,
        ship: null,
        research: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [building, defense, ship, research] = await Promise.all([
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readPlanetQueue("0x5758361d", planetId, "defense"),
      this.readPlanetQueue("0xb6f4b7b7", planetId, "ship"),
      this.readResearchQueue(wallet)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      building,
      defense,
      ship,
      research
    };
  }

  async getFleetMissionVisibility(wallet: Address): Promise<FleetMissionVisibility> {
    const planets = await this.getWalletPlanets(wallet);
    if (!planets.homePlanetId) {
      return { wallet, homePlanetId: null, incoming: [], outgoing: [], returning: [], joinableAttacks: [] };
    }

    const walletLower = wallet.toLowerCase();
    const ownedPlanetIds = new Set(planets.planets.map((planet) => planet.planetId));
    const summaries = await this.readFleetMissionSummaries();

    return {
      wallet,
      homePlanetId: planets.homePlanetId,
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

  async listResolvableFleetMissions(): Promise<ResolvableFleetMission[]> {
    const summaries = await this.readFleetMissionSummaries();
    return summaries
      .filter((mission) =>
        mission.needsResolution
          && (
            mission.missionType === "Attack"
              || mission.missionType === "Harvest"
              || mission.missionType === "Colonize"
          )
      )
      .map(({ arrivalAt, missionId, missionType, originPlanetId, targetPlanetId }) => ({
        arrivalAt,
        missionId,
        missionType,
        originPlanetId,
        targetPlanetId
      }));
  }

  async getInfrastructureState(wallet: Address, selectedPlanetId?: bigint): Promise<InfrastructureState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        infrastructureAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Infrastructure upgrades are not available on this deployment yet.",
        resources: null,
        productionPerHour: null,
        energyBalance: null,
        storageCaps: null,
        protectedResources: null,
        raidableResources: null,
        technologyLevels: {},
        buildings: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        infrastructureAvailable: true,
        resources: null,
        productionPerHour: null,
        energyBalance: null,
        storageCaps: null,
        protectedResources: null,
        raidableResources: null,
        technologyLevels: {},
        buildings: Array.from({ length: buildingCount }, (_, id) => ({
          id,
          level: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [
      resources,
      productionPerHour,
      energyBalance,
      storageCaps,
      protectedResources,
      raidableResources,
      queue,
      buildings,
      technologyLevels
    ] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readResources("0x9ec5e0d5", planetId),
      this.readEnergyBalance(planetId),
      this.readResources("0x6db0ecd7", planetId),
      this.readOptionalResources("0x222a58f5", planetId),
      this.readOptionalResources("0x1da1f692", planetId),
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readBuildingRows(planetId),
      this.readTechnologyLevels(wallet)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      infrastructureAvailable: true,
      resources,
      productionPerHour,
      energyBalance,
      storageCaps,
      protectedResources,
      raidableResources,
      technologyLevels,
      buildings,
      queue
    };
  }

  async getMoonState(wallet: Address, selectedPlanetId?: bigint): Promise<MoonState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return emptyMoonState(
        wallet,
        null,
        "The deployed contract only supports first-planet settlement. Moon systems are not available on this deployment yet."
      );
    }

    if (!settlement.homePlanetId) {
      return emptyMoonState(wallet, null, "Settle a home planet before using moon systems.");
    }

    const planetId = BigInt(settlement.homePlanetId);
    try {
      const moon = await this.readMoon(planetId);
      if (!moon.exists) {
        return {
          ...emptyMoonState(wallet, settlement.homePlanetId, "No moon exists for this home planet yet."),
          moonAvailable: true
        };
      }

      const [buildings, queue] = await Promise.all([
        this.readMoonBuildingRows(planetId),
        this.readMoonQueue(planetId)
      ]);

      return {
        wallet,
        homePlanetId: settlement.homePlanetId,
        moonAvailable: true,
        moon,
        buildings,
        queue
      };
    } catch (error) {
      if (isRpcRevert(error)) {
        return emptyMoonState(
          wallet,
          settlement.homePlanetId,
          "This deployment does not expose Veydrift moon systems yet."
        );
      }

      throw error;
    }
  }

  async getShipyardState(wallet: Address, selectedPlanetId?: bigint): Promise<ShipyardState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        productionAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Ship production is not available on this deployment yet.",
        resources: null,
        fleetSlots: { active: 0, limit: 1 },
        shipyardLevel: 0,
        naniteLevel: 0,
        technologyLevels: {},
        ships: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        productionAvailable: true,
        resources: null,
        fleetSlots: { active: 0, limit: 1 },
        shipyardLevel: 0,
        naniteLevel: 0,
        technologyLevels: {},
        ships: supportedShipIds.map((id) => ({
          id,
          count: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, shipyardLevel, naniteLevel, queue, technologyLevels, ships, activeFleetMissions] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(11n)]),
      this.readPlanetQueue("0xb6f4b7b7", planetId, "ship"),
      this.readTechnologyLevels(wallet),
      this.readShipRows(planetId),
      this.readOptionalUintCall("0x423f9f10", [encodeAddress(wallet)])
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      productionAvailable: true,
      resources,
      fleetSlots: {
        active: Number(activeFleetMissions ?? 0n),
        limit: 1 + (technologyLevels["4"] ?? 0)
      },
      shipyardLevel: Number(shipyardLevel),
      naniteLevel: Number(naniteLevel),
      technologyLevels,
      ships,
      queue
    };
  }

  async getDefenseState(wallet: Address, selectedPlanetId?: bigint): Promise<DefenseState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        productionAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Defense production is not available on this deployment yet.",
        resources: null,
        shipyardLevel: 0,
        missileSiloLevel: 0,
        technologyLevels: {},
        defenses: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        productionAvailable: true,
        resources: null,
        shipyardLevel: 0,
        missileSiloLevel: 0,
        technologyLevels: {},
        defenses: Array.from({ length: defenseCount }, (_, id) => ({
          id,
          count: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, shipyardLevel, missileSiloLevel, queue, technologyLevels, defenses] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(14n)]),
      this.readPlanetQueue("0x5758361d", planetId, "defense"),
      this.readTechnologyLevels(wallet),
      this.readDefenseRows(planetId)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      productionAvailable: true,
      resources,
      shipyardLevel: Number(shipyardLevel),
      missileSiloLevel: Number(missileSiloLevel),
      technologyLevels,
      defenses,
      queue
    };
  }

  async getResearchState(wallet: Address, selectedPlanetId?: bigint): Promise<ResearchState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        researchAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Research is not available on this deployment yet.",
        resources: null,
        researchLabLevel: 0,
        researchNetworkLabLevels: [],
        technologyLevels: {},
        technologies: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        researchAvailable: true,
        resources: null,
        researchLabLevel: 0,
        researchNetworkLabLevels: [],
        technologyLevels: {},
        technologies: supportedTechnologyIds.map((id) => ({
          id,
          level: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, researchLabLevel, researchNetworkLabLevels, queue, technologyLevels, technologies] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(6n)]),
      this.readResearchNetworkLabLevels(wallet, planetId),
      this.readResearchQueue(wallet),
      this.readTechnologyLevels(wallet),
      this.readTechnologyRows(wallet)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      researchAvailable: true,
      resources,
      researchLabLevel: Number(researchLabLevel),
      researchNetworkLabLevels,
      technologyLevels,
      technologies,
      queue
    };
  }

  async getRiftState(wallet: Address, selectedPlanetId?: bigint): Promise<RiftState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return emptyRiftState(
        wallet,
        null,
        "The deployed contract only supports first-planet settlement. The Rift bridge is not available on this deployment yet."
      );
    }

    if (!settlement.homePlanetId || !settlement.planet) {
      return emptyRiftState(wallet, null, "Settle a home planet before using the Interdimensional Rift Stabilizer.");
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [riftLevel, roboticsLevel, researchLabLevel, technologyLevels] = await Promise.all([
      this.readOptionalUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(BigInt(riftBuildingId))]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(4n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(6n)]),
      this.readTechnologyLevels(wallet)
    ]);

    const bridgeBuilt = riftLevel === null ? null : riftLevel > 0n;
    const requirements = riftRequirements(
      bridgeBuilt,
      Number(roboticsLevel),
      Number(researchLabLevel),
      technologyLevels
    );
    const unlocked = bridgeBuilt === true;
    const tokenAddressesConfigured = riftResourceCatalog.every((resource) => this.resourceTokenAddresses[resource.key]);
    const pendingWithdrawals = await this.readRiftWithdrawals(wallet);
    const resources = await this.readRiftResources(wallet, settlement.planet.resources, pendingWithdrawals);
    const unavailableReason = riftLevel === null
      ? "This deployment does not expose the Interdimensional Rift Stabilizer building yet."
      : !unlocked
        ? "Build the Interdimensional Rift Stabilizer on this planet to unlock resource bridging."
        : !tokenAddressesConfigured
          ? "Resource token addresses are not configured for this deployment yet."
          : undefined;

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      riftAvailable: unlocked && tokenAddressesConfigured,
      unlocked,
      ...(unavailableReason ? { unavailableReason } : {}),
      withdrawalDelaySeconds: riftWithdrawalDelaySeconds.toString(),
      requirements,
      resources,
      pendingWithdrawals
    };
  }

  async getAllianceState(wallet: Address): Promise<AllianceState> {
    assertAddress(wallet);
    const unavailable = (reason: string): AllianceState => ({
      wallet,
      allianceAvailable: false,
      unavailableReason: reason,
      membership: { allianceId: "0", role: "none", joinedAt: "0" },
      profile: null,
      directory: [],
      pendingInvites: [],
      pendingJoinRequests: [],
      allianceJoinRequests: [],
      members: []
    });

    if (!this.allianceContractAddress) {
      return unavailable("Alliance contract is not configured for this deployment yet.");
    }

    const membershipWords = splitWords(
      await this.callContract(this.allianceContractAddress, "0xad642b52", [encodeAddress(wallet)])
    );
    const allianceId = decodeUintWord(wordAt(membershipWords, 0));
    const role = allianceRoleName(Number(decodeUintWord(wordAt(membershipWords, 1))));
    const joinedAt = decodeUintWord(wordAt(membershipWords, 2)).toString();
    const allianceIds = decodeUintArray(await this.callContract(this.allianceContractAddress, "0xf0bab901", []));
    const profileResults = await this.batchCallContract(
      this.allianceContractAddress,
      allianceIds.map((id) => ({ selector: "0x79c76adf", args: [encodeUint(id)] }))
    );
    const directory = allianceIds.map((id, index) => decodeAllianceDirectoryEntry(id, splitWords(profileResults[index] ?? "0x")))
      .filter((entry) => entry.active);
    const [inviteResults, walletJoinRequestResults] = await Promise.all([
      this.batchCallContract(
        this.allianceContractAddress,
        allianceIds.map((id) => ({ selector: "0xf4d46b3b", args: [encodeAddress(wallet), encodeUint(id)] }))
      ),
      this.batchCallContract(
        this.allianceContractAddress,
        allianceIds.map((id) => ({ selector: "0xdb132ffb", args: [encodeAddress(wallet), encodeUint(id)] }))
      )
    ]);
    const pendingInvites = allianceIds.flatMap((id, index) => {
      const words = splitWords(inviteResults[index] ?? "0x");
      return decodeBoolWord(wordAt(words, 0))
        ? [{
          allianceId: id.toString(),
          inviter: decodeAddressWord(wordAt(words, 2)),
          invitedAt: decodeUintWord(wordAt(words, 3)).toString()
        }]
        : [];
    });
    const pendingJoinRequests = allianceIds.flatMap((id, index) => {
      const words = splitWords(walletJoinRequestResults[index] ?? "0x");
      return decodeBoolWord(wordAt(words, 0))
        ? [{
          allianceId: id.toString(),
          requester: decodeAddressWord(wordAt(words, 2)),
          requestedAt: decodeUintWord(wordAt(words, 3)).toString()
        }]
        : [];
    });

    if (allianceId === 0n) {
      return {
        wallet,
        allianceAvailable: true,
        membership: { allianceId: "0", role, joinedAt },
        profile: null,
        directory,
        pendingInvites,
        pendingJoinRequests,
        allianceJoinRequests: [],
        members: []
      };
    }

    const profile = directory.find((entry) => entry.allianceId === allianceId.toString()) ?? null;
    const memberAddresses = decodeAddressArray(
      await this.callContract(this.allianceContractAddress, "0x2a1ef311", [encodeUint(allianceId)])
    );
    const joinRequestAddresses = decodeAddressArray(
      await this.callContract(this.allianceContractAddress, "0x2953e5ce", [encodeUint(allianceId)])
    );
    const [memberMemberships, joinRequestResults] = await Promise.all([
      this.batchCallContract(
        this.allianceContractAddress,
        memberAddresses.map((address) => ({ selector: "0xad642b52", args: [encodeAddress(address)] }))
      ),
      this.batchCallContract(
        this.allianceContractAddress,
        joinRequestAddresses.map((address) => ({ selector: "0xdb132ffb", args: [encodeAddress(address), encodeUint(allianceId)] }))
      )
    ]);
    const allianceJoinRequests = joinRequestAddresses.flatMap((address, index) => {
      const words = splitWords(joinRequestResults[index] ?? "0x");
      return decodeBoolWord(wordAt(words, 0))
        ? [{
          allianceId: allianceId.toString(),
          requester: address,
          requestedAt: decodeUintWord(wordAt(words, 3)).toString()
        }]
        : [];
    });

    return {
      wallet,
      allianceAvailable: true,
      membership: { allianceId: allianceId.toString(), role, joinedAt },
      profile: profile ? {
        active: profile.active,
        tag: profile.tag,
        name: profile.name,
        description: profile.description,
        owner: profile.owner,
        createdAt: profile.createdAt,
        memberCount: profile.memberCount
      } : null,
      directory,
      pendingInvites,
      pendingJoinRequests,
      allianceJoinRequests,
      members: memberAddresses.map((address, index) => {
        const words = splitWords(memberMemberships[index] ?? "0x");
        return {
          address,
          role: allianceRoleName(Number(decodeUintWord(wordAt(words, 1)))),
          joinedAt: decodeUintWord(wordAt(words, 2)).toString()
        };
      })
    };
  }

  async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
    const result = new Map<Address, AllianceIdentity>();
    if (!this.allianceContractAddress || wallets.length === 0) return result;

    const uniqueWallets = Array.from(new Set(wallets.map((wallet) => wallet.toLowerCase() as Address)));
    const membershipResults = await this.batchCallContract(
      this.allianceContractAddress,
      uniqueWallets.map((wallet) => ({ selector: "0xad642b52", args: [encodeAddress(wallet)] }))
    );
    const memberships = uniqueWallets.map((wallet, index) => {
      const words = splitWords(membershipResults[index] ?? "0x");
      return {
        wallet,
        allianceId: decodeUintWord(wordAt(words, 0))
      };
    }).filter((membership) => membership.allianceId !== 0n);
    const uniqueAllianceIds = Array.from(new Set(memberships.map((membership) => membership.allianceId.toString())))
      .map((allianceId) => BigInt(allianceId));

    if (uniqueAllianceIds.length === 0) return result;

    const profileResults = await this.batchCallContract(
      this.allianceContractAddress,
      uniqueAllianceIds.map((allianceId) => ({ selector: "0x79c76adf", args: [encodeUint(allianceId)] }))
    );
    const profiles = new Map(
      uniqueAllianceIds.flatMap((allianceId, index) => {
        const profile = decodeAllianceDirectoryEntry(allianceId, splitWords(profileResults[index] ?? "0x"));
        return profile.active
          ? [[allianceId.toString(), { allianceId: allianceId.toString(), tag: profile.tag, name: profile.name }]]
          : [];
      })
    );

    for (const membership of memberships) {
      const profile = profiles.get(membership.allianceId.toString());
      if (profile) result.set(membership.wallet, profile);
    }

    return result;
  }

  async getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus> {
    assertAddress(wallet);
    const words = splitWords(await this.call("0x8a6b2246", [encodeAddress(wallet), encodeUint(targetPlanetId)]));
    const blockedReason = decodeAttackBlockReason(Number(decodeUintWord(wordAt(words, 0))));
    const flags = words.length > 1 ? Number(decodeUintWord(wordAt(words, 1))) : 0;
    const plunderBps = words.length > 2 ? Number(decodeUintWord(wordAt(words, 2))) : 5000;

    return {
      wallet,
      targetPlanetId: targetPlanetId.toString(),
      allowed: blockedReason === "none",
      blockedReason,
      blockedReasonLabel: attackBlockReasonLabel(blockedReason),
      relation: decodeAttackRelation(flags),
      defenderHonorStatus: decodeHonorStatus(flags),
      plunderBps,
      defenderInactive: (flags & 16) !== 0
    };
  }

  async getHighscoreForWallet(wallet: Address, planetIds?: string[]): Promise<HighscoreEntry> {
    assertAddress(wallet);
    const settlement = await this.getWalletSettlement(wallet);
    const candidatePlanetIds = planetIds?.length
      ? planetIds
      : settlement.homePlanetId
        ? [settlement.homePlanetId]
        : [];

    const planetStates = await Promise.all(
      candidatePlanetIds.map(async (planetId) => {
        const planet = await this.getPlanet(BigInt(planetId));
        return planet?.owner.toLowerCase() === wallet.toLowerCase() ? planet : null;
      })
    );
    const ownedPlanets = planetStates.filter((planet): planet is PlanetState => planet !== null);
    const planetScores = await Promise.all(
      ownedPlanets.map(async (planet) => {
        const planetId = BigInt(planet.planetId);
        const [buildings, defenses, ships, moonBuildings] = await Promise.all([
          this.readBuildingRows(planetId),
          this.readDefenseRows(planetId),
          this.readShipRows(planetId),
          this.readMoonBuildingHighscoreRows(planetId, wallet)
        ]);
        return { buildings, moonBuildings, defenses, ships };
      })
    );
    const technologies = await this.readTechnologyRows(wallet);

    return calculateHighscore({
      wallet,
      homePlanetId: settlement.homePlanetId,
      planetCount: ownedPlanets.length,
      planets: planetScores,
      technologies
    });
  }

  async getHighscoresForWallets(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): Promise<HighscoreEntry[]> {
    const owners = [...planetsByOwner.keys()].map((owner) => {
      assertAddress(owner);
      return owner as Address;
    });
    if (owners.length === 0) return [];

    const planetIds = [...new Set([...planetsByOwner.values()].flat().map((planet) => planet.planetId))]
      .sort((left, right) => Number(BigInt(left) - BigInt(right)));

    const calls = [
      ...owners.map((owner) => ({
        selector: "0x0ff79fa5",
        args: [encodeAddress(owner)]
      })),
      ...owners.flatMap((owner) => supportedTechnologyIds.map((id) => ({
        selector: "0xe512884c",
        args: [encodeAddress(owner), encodeUint(BigInt(id))]
      }))),
      ...planetIds.flatMap((planetId) => Array.from({ length: buildingCount }, (_, id) => ({
        selector: "0xd9b24865",
        args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(id))]
      }))),
      ...planetIds.flatMap((planetId) => Array.from({ length: defenseCount }, (_, id) => ({
        selector: "0x836e3a32",
        args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(id))]
      }))),
      ...planetIds.flatMap((planetId) => supportedShipIds.map((id) => ({
        selector: "0x57686701",
        args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(id))]
      })))
    ];
    const results = await this.batchCallContract(this.gameContractAddress, calls);
    let cursor = 0;

    const homePlanetByOwner = new Map(
      owners.map((owner) => {
        const homePlanetId = decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0));
        return [owner.toLowerCase(), homePlanetId === 0n ? null : homePlanetId.toString()] as const;
      })
    );
    const technologiesByOwner = new Map<string, Array<{ id: number; level: number }>>();
    for (const owner of owners) {
      technologiesByOwner.set(owner.toLowerCase(), supportedTechnologyIds.map((id) => ({
        id,
        level: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
      })));
    }

    const planetScores = new Map<string, {
      buildings: Array<{ id: number; level: number }>;
      defenses: Array<{ id: number; count: number }>;
      ships: Array<{ id: number; count: number }>;
    }>();
    for (const planetId of planetIds) {
      planetScores.set(planetId, {
        buildings: Array.from({ length: buildingCount }, (_, id) => ({
          id,
          level: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
        })),
        defenses: [],
        ships: []
      });
    }
    for (const planetId of planetIds) {
      const score = planetScores.get(planetId);
      if (!score) continue;
      score.defenses = Array.from({ length: defenseCount }, (_, id) => ({
        id,
        count: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
      }));
    }
    for (const planetId of planetIds) {
      const score = planetScores.get(planetId);
      if (!score) continue;
      score.ships = supportedShipIds.map((id) => ({
        id,
        count: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
      }));
    }

    const moonBuildingsByPlanet = await this.readMoonBuildingHighscoreRowsForPlanets(planetIds);

    return owners.map((owner) => {
      const ownerKey = owner.toLowerCase();
      const planets = planetsByOwner.get(ownerKey) ?? [];
      return calculateHighscore({
        wallet: owner,
        homePlanetId: homePlanetByOwner.get(ownerKey) ?? null,
        planetCount: planets.length,
        planets: planets.flatMap((planet) => {
          const score = planetScores.get(planet.planetId);
          return score
            ? [{ ...score, moonBuildings: moonBuildingsByPlanet.get(planet.planetId) ?? [] }]
            : [];
        }),
        technologies: technologiesByOwner.get(ownerKey) ?? []
      });
    });
  }

  async listSettledPlanetEvents(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<SettledPlanetEvent[]> {
    const logs = await this.getLogs(
      {
        address: this.gameContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[planetStartedTopic, colonyCreatedTopic]]
      }
    );

    return logs.map((log) => decodeSettledPlanetLog(log));
  }

  async listCurrentPlanets(): Promise<SettledPlanetEvent[]> {
    const nextPlanetId = await this.readUintCall("0xc16bedad", []);
    if (nextPlanetId <= 1n) return [];

    const planetIds = Array.from({ length: Number(nextPlanetId - 1n) }, (_, index) => BigInt(index + 1));
    const results = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.flatMap((planetId) => ([
        {
          selector: "0x181c1bc4",
          args: [encodeUint(planetId)]
        },
        {
          selector: "0xec16d865",
          args: [encodeUint(planetId)]
        }
      ]))
    );

    return planetIds.flatMap((planetId, index) => {
      const result = results[index * 2] ?? "0x";
      const nameResult = results[index * 2 + 1] ?? "0x";
      const words = splitWords(result);
      const owner = decodeAddressWord(wordAt(words, 0));
      if (owner === zeroAddress) return [];

      return [{
        eventName: "PlanetStarted",
        transactionHash: "0x",
        blockNumber: "0",
        owner,
        planetId: planetId.toString(),
        name: decodeNullableStringResult(nameResult),
        galaxy: Number(decodeUintWord(wordAt(words, 1))),
        system: Number(decodeUintWord(wordAt(words, 2))),
        position: Number(decodeUintWord(wordAt(words, 3))),
        fields: Number(decodeUintWord(wordAt(words, 4))),
        temperature: Number(decodeSignedWord(wordAt(words, 5))),
        metalMultiplierBps: Number(decodeUintWord(wordAt(words, 6))),
        crystalMultiplierBps: Number(decodeUintWord(wordAt(words, 7))),
        deuteriumMultiplierBps: Number(decodeUintWord(wordAt(words, 8))),
        lastSettledAt: decodeUintWord(wordAt(words, 9)).toString(),
        resources: decodeResources(words.slice(10, 13))
      } satisfies SettledPlanetEvent];
    });
  }

  async listMoonChanceReportEvents(
    fromBlock: bigint,
    toBlock: bigint | "latest" = "latest"
  ): Promise<MoonChanceReportEvent[]> {
    if (!this.moonContractAddress) return [];

    const logs = await this.getLogs(
      {
        address: this.moonContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[
          moonChanceRequestedTopic,
          moonChanceFinalizedTopic,
          moonChanceSkippedExistingMoonTopic,
          moonDestructionRequestedTopic,
          moonDestructionFinalizedTopic
        ]]
      }
    );

    return logs.map((log) => decodeMoonChanceReportLog(log));
  }

  async listDebrisFieldEvents(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<DebrisFieldEvent[]> {
    const logs = await this.getLogs(
      {
        address: this.gameContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[debrisFieldUpdatedTopic]]
      }
    );

    return logs.map((log) => decodeDebrisFieldLog(log));
  }

  private async getGameSettlement(wallet: Address): Promise<WalletSettlement> {
    const homePlanetId = decodeUint(await this.call("0x0ff79fa5", [encodeAddress(wallet)]));
    const planet = homePlanetId === 0n ? null : await this.getPlanet(homePlanetId);

    return {
      wallet,
      hasFirstPlanet: homePlanetId !== 0n,
      homePlanetId: homePlanetId === 0n ? null : homePlanetId.toString(),
      planet,
      contractKind: "game"
    };
  }

  private async readPlanetQueue(selector: string, planetId: bigint, kind: "building" | "defense" | "ship"): Promise<QueueState> {
    const words = splitWords(await this.call(selector, [encodeUint(planetId)]));
    const active = decodeBoolWord(wordAt(words, 0));
    const queue: QueueState = {
      active,
      kind: active ? kind : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      ...(kind === "building"
        ? { targetLevel: Number(decodeUintWord(wordAt(words, 2))) }
        : { quantity: Number(decodeUintWord(wordAt(words, 2))) }),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };

    if (kind === "building" && active) {
      queue.startedAt = await this.readBuildingStartedAt(planetId, queue);
    } else if (kind === "defense" && active) {
      queue.startedAt = await this.readDefenseStartedAt(planetId, queue);
    }

    return queue;
  }

  private async readMoonQueue(planetId: bigint): Promise<QueueState> {
    const words = splitWords(await this.moonCall("0x2216f950", [encodeUint(planetId)]));
    const active = decodeBoolWord(wordAt(words, 0));
    return {
      active,
      kind: active ? "moon-building" : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      targetLevel: Number(decodeUintWord(wordAt(words, 2))),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };
  }

  private async readBuildingStartedAt(planetId: bigint, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.targetLevel === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            buildingStartedTopic,
            toTopic(planetId),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingBuildingStartedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async readDefenseStartedAt(planetId: bigint, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.quantity === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            defenseQueuedTopic,
            toTopic(planetId),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingDefenseQueuedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async getLogs(filter: RpcLogFilter): Promise<RpcLog[]> {
    try {
      return await this.transport.request<RpcLog[]>("eth_getLogs", [filter]);
    } catch (error) {
      if (!shouldChunkLogQuery(error)) {
        throw error;
      }
    }

    const fromBlock = decodeUint(filter.fromBlock);
    const toBlock = filter.toBlock === "latest"
      ? decodeUint(await this.transport.request<string>("eth_blockNumber", []))
      : decodeUint(filter.toBlock);
    if (toBlock < fromBlock) return [];

    return this.getLogsInChunks(filter, fromBlock, toBlock, 9n);
  }

  private async getLogsInChunks(
    filter: RpcLogFilter,
    fromBlock: bigint,
    toBlock: bigint,
    maxChunkSpan: bigint
  ): Promise<RpcLog[]> {
    const logs: RpcLog[] = [];
    for (let start = fromBlock; start <= toBlock; start += maxChunkSpan + 1n) {
      const end = start + maxChunkSpan > toBlock ? toBlock : start + maxChunkSpan;
      logs.push(...await this.getLogsRange(filter, start, end));
    }
    return logs;
  }

  private async getLogsRange(filter: RpcLogFilter, fromBlock: bigint, toBlock: bigint): Promise<RpcLog[]> {
    try {
      return await this.transport.request<RpcLog[]>("eth_getLogs", [{
        ...filter,
        fromBlock: toQuantity(fromBlock),
        toBlock: toQuantity(toBlock)
      }]);
    } catch (error) {
      if (!shouldChunkLogQuery(error) || fromBlock >= toBlock) {
        throw error;
      }
    }

    const midpoint = fromBlock + ((toBlock - fromBlock) / 2n);
    const left = await this.getLogsRange(filter, fromBlock, midpoint);
    const right = await this.getLogsRange(filter, midpoint + 1n, toBlock);
    return [...left, ...right];
  }

  private async readResearchQueue(wallet: Address): Promise<QueueState> {
    const words = splitWords(await this.call("0x2b98afc7", [encodeAddress(wallet)]));
    const active = decodeBoolWord(wordAt(words, 0));
    const queue: QueueState = {
      active,
      kind: active ? "research" : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      targetLevel: Number(decodeUintWord(wordAt(words, 2))),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };

    if (active) {
      queue.startedAt = await this.readResearchStartedAt(wallet, queue);
    }

    return queue;
  }

  private async readResearchStartedAt(wallet: Address, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.targetLevel === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            researchQueuedTopic,
            toAddressTopic(wallet),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingResearchQueuedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async readTechnologyLevels(wallet: Address): Promise<Record<string, number>> {
    const results = await this.batchCallContract(
      this.gameContractAddress,
      supportedTechnologyIds.map((id) => ({
        selector: "0xe512884c",
        args: [encodeAddress(wallet), encodeUint(BigInt(id))]
      }))
    );
    const entries = supportedTechnologyIds.map((id, index) => [
      id.toString(),
      Number(decodeUintWord(wordAt(splitWords(results[index] ?? "0x"), 0)))
    ] as const);

    return Object.fromEntries(entries);
  }

  private async readShipRows(planetId: bigint): Promise<ShipyardState["ships"]> {
    try {
      const results = await this.batchCallContract(
        this.gameContractAddress,
        supportedShipIds.flatMap((id) => ([
          {
            selector: "0x57686701",
            args: [encodeUint(planetId), encodeUint(BigInt(id))]
          },
          {
            selector: "0xc4222030",
            args: [encodeUint(BigInt(id))]
          }
        ]))
      );

      return supportedShipIds.map((id, index) => ({
        id,
        count: Number(decodeUintWord(wordAt(splitWords(results[index * 2] ?? "0x"), 0))),
        cost: decodeResources(splitWords(results[index * 2 + 1] ?? "0x"))
      }));
    } catch (error) {
      if (!isRpcRevert(error)) {
        throw error;
      }
    }

    const rows: Array<ShipyardState["ships"][number] | null> = [];
    for (const id of supportedShipIds) {
      rows.push(await this.readShipRow(planetId, id));
    }

    return rows.filter((row): row is ShipyardState["ships"][number] => row !== null);
  }

  private async readShipRow(planetId: bigint, id: number): Promise<ShipyardState["ships"][number] | null> {
    try {
      const [count, cost] = await Promise.all([
        this.readUintCall("0x57686701", [encodeUint(planetId), encodeUint(BigInt(id))]),
        this.readResources("0xc4222030", BigInt(id))
      ]);

      return {
        id,
        count: Number(count),
        cost
      };
    } catch (error) {
      if (isRpcRevert(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readDefenseRows(planetId: bigint): Promise<DefenseState["defenses"]> {
    const results = await this.batchCallContract(
      this.gameContractAddress,
      Array.from({ length: defenseCount }, (_, id) => ([
        {
          selector: "0x836e3a32",
          args: [encodeUint(planetId), encodeUint(BigInt(id))]
        },
        {
          selector: "0x9b906295",
          args: [encodeUint(BigInt(id))]
        }
      ])).flat()
    );

    return Array.from({ length: defenseCount }, (_, id) => ({
      id,
      count: Number(decodeUintWord(wordAt(splitWords(results[id * 2] ?? "0x"), 0))),
      cost: decodeResources(splitWords(results[id * 2 + 1] ?? "0x"))
    })
    );
  }

  private async readBuildingRows(planetId: bigint): Promise<InfrastructureState["buildings"]> {
    const calls = Array.from({ length: buildingCount }, (_, id) => ([
      {
        selector: "0xd9b24865",
        args: [encodeUint(planetId), encodeUint(BigInt(id))]
      },
      {
        selector: "0x291ee1b5",
        args: [encodeUint(planetId), encodeUint(BigInt(id))]
      }
    ])).flat();
    const results = await this.batchCallContract(this.gameContractAddress, calls);

    return Array.from({ length: buildingCount }, (_, id) => {
      const levelResult = results[id * 2];
      const costResult = results[id * 2 + 1];
      if (!levelResult || !costResult) {
        throw new Error("RPC batch response missing building row.");
      }

      return {
        id,
        level: Number(decodeUintWord(wordAt(splitWords(levelResult), 0))),
        cost: decodeResources(splitWords(costResult))
      };
    });
  }

  private async readMoon(planetId: bigint): Promise<NonNullable<MoonState["moon"]>> {
    const words = splitWords(await this.moonCall("0xce028855", [encodeUint(planetId)]));
    return {
      exists: decodeBoolWord(wordAt(words, 0)),
      planetId: decodeUintWord(wordAt(words, 1)).toString(),
      owner: decodeAddressWord(wordAt(words, 2)),
      fields: Number(decodeUintWord(wordAt(words, 3))),
      diameterKm: Number(decodeUintWord(wordAt(words, 4))),
      createdAt: decodeUintWord(wordAt(words, 5)).toString(),
      jumpGateReadyAt: decodeUintWord(wordAt(words, 6)).toString()
    };
  }

  private async readMoonBuildingRows(planetId: bigint): Promise<MoonState["buildings"]> {
    return Promise.all(
      moonBuildingCatalog.map(async (building) => {
        const [level, cost] = await Promise.all([
          this.readMoonUintCall("0x4e6a984f", [encodeUint(planetId), encodeUint(BigInt(building.id))]),
          this.readMoonResourcesCall("0xa9114d32", [encodeUint(planetId), encodeUint(BigInt(building.id))])
        ]);

        return {
          ...building,
          level: Number(level),
          cost
        };
      })
    );
  }

  private async readMoonBuildingHighscoreRows(
    planetId: bigint,
    wallet: Address
  ): Promise<Array<{ id: number; level: number }>> {
    if (!this.moonContractAddress) return [];

    try {
      const moon = await this.readMoon(planetId);
      if (!moon.exists || moon.owner.toLowerCase() !== wallet.toLowerCase()) return [];
      const rows = await this.readMoonBuildingRows(planetId);
      return rows.map(({ id, level }) => ({ id, level }));
    } catch (error) {
      if (isRpcRevert(error)) return [];
      throw error;
    }
  }

  private async readMoonBuildingHighscoreRowsForPlanets(
    planetIds: string[]
  ): Promise<Map<string, Array<{ id: number; level: number }>>> {
    const rows = new Map<string, Array<{ id: number; level: number }>>();
    if (!this.moonContractAddress || planetIds.length === 0) return rows;

    try {
      const moonResults = await this.batchCallContract(
        this.moonContractAddress,
        planetIds.map((planetId) => ({
          selector: "0xce028855",
          args: [encodeUint(BigInt(planetId))]
        }))
      );
      const planetsWithMoons = planetIds.filter((_, index) => (
        decodeBoolWord(wordAt(splitWords(moonResults[index] ?? "0x"), 0))
      ));
      const levelResults = await this.batchCallContract(
        this.moonContractAddress,
        planetsWithMoons.flatMap((planetId) => moonBuildingCatalog.map((building) => ({
          selector: "0x4e6a984f",
          args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(building.id))]
        })))
      );

      let cursor = 0;
      for (const planetId of planetsWithMoons) {
        rows.set(planetId, moonBuildingCatalog.map((building) => ({
          id: building.id,
          level: Number(decodeUintWord(wordAt(splitWords(levelResults[cursor++] ?? "0x"), 0)))
        })));
      }
    } catch (error) {
      if (isRpcRevert(error)) return new Map();
      throw error;
    }

    return rows;
  }

  private async readTechnologyRows(wallet: Address): Promise<ResearchState["technologies"]> {
    const results = await this.batchCallContract(
      this.gameContractAddress,
      supportedTechnologyIds.flatMap((id) => ([
        {
          selector: "0xe512884c",
          args: [encodeAddress(wallet), encodeUint(BigInt(id))]
        },
        {
          selector: "0x6e984888",
          args: [encodeAddress(wallet), encodeUint(BigInt(id))]
        }
      ]))
    );

    return supportedTechnologyIds.map((id, index) => ({
      id,
      level: Number(decodeUintWord(wordAt(splitWords(results[index * 2] ?? "0x"), 0))),
      cost: decodeResources(splitWords(results[index * 2 + 1] ?? "0x"))
    })
    );
  }

  private async readRiftResources(
    wallet: Address,
    inGameResources: Resources,
    pendingWithdrawals: PendingWithdrawal[]
  ): Promise<RiftResourceState[]> {
    return Promise.all(
      riftResourceCatalog.map(async (resource) => {
        const tokenAddress = this.resourceTokenAddresses[resource.key] ?? null;
        const lockedBalance = pendingWithdrawals.find((withdrawal) => withdrawal.resource === resource.key)?.amount ?? "0";
        if (!tokenAddress) {
          return {
            ...resource,
            tokenAddress,
            walletBalance: null,
            allowance: null,
            inGameBalance: inGameResources[resource.key],
            lockedBalance
          };
        }

        const [walletBalance, allowance] = await Promise.all([
          this.readErc20Uint(tokenAddress, "0x70a08231", [encodeAddress(wallet)]),
          this.readErc20Uint(tokenAddress, "0xdd62ed3e", [encodeAddress(wallet), encodeAddress(this.gameContractAddress)])
        ]);

        return {
          ...resource,
          tokenAddress,
          walletBalance: walletBalance.toString(),
          allowance: allowance.toString(),
          inGameBalance: inGameResources[resource.key],
          lockedBalance
        };
      })
    );
  }

  private async readRiftWithdrawals(wallet: Address): Promise<PendingWithdrawal[]> {
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const withdrawals = await Promise.all(
      riftResourceCatalog.map(async (resource) => {
        const words = splitWords(await this.call("0x91f8dfce", [encodeAddress(wallet), encodeUint(BigInt(resource.resourceId))]));
        const active = decodeBoolWord(wordAt(words, 0));
        if (!active) {
          return null;
        }

        const amount = decodeUintWord(wordAt(words, 3));
        const unlocksAt = decodeUintWord(wordAt(words, 4));
        const requestedAt = unlocksAt > BigInt(riftWithdrawalDelaySeconds)
          ? unlocksAt - BigInt(riftWithdrawalDelaySeconds)
          : 0n;

        const withdrawal: PendingWithdrawal = {
          id: resource.key,
          resource: resource.key,
          amount: amount.toString(),
          requestedAt: new Date(Number(requestedAt) * 1000).toISOString(),
          unlocksAt: new Date(Number(unlocksAt) * 1000).toISOString(),
          ready: nowSeconds >= unlocksAt
        };

        return withdrawal;
      })
    );

    return withdrawals.filter((withdrawal): withdrawal is PendingWithdrawal => withdrawal !== null);
  }

  private async readManagedPlanet(planet: PlanetState, homePlanetId: string | null): Promise<ManagedPlanet> {
    const planetId = BigInt(planet.planetId);
    const [buildings, building, defense, ship, moon] = await Promise.all([
      this.readBuildingRows(planetId),
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readPlanetQueue("0x5758361d", planetId, "defense"),
      this.readPlanetQueue("0xb6f4b7b7", planetId, "ship"),
      this.readMoonSummary(planetId)
    ]);
    const level = (id: number) => buildings.find((building) => building.id === id)?.level ?? 0;
    const fieldsUsed = buildings.reduce((sum, building) => sum + building.level, 0);

    return {
      ...planet,
      coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
      isHomePlanet: planet.planetId === homePlanetId,
      fieldsUsed,
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
      queues: {
        building,
        defense,
        ship
      },
      moon
    };
  }

  private async readResearchNetworkLabLevels(wallet: Address, selectedPlanetId: bigint): Promise<number[]> {
    const planets = await this.getWalletPlanets(wallet);
    return planets.planets
      .filter((planet) => BigInt(planet.planetId) !== selectedPlanetId)
      .map((planet) => planet.keyLevels.researchLab)
      .filter((level) => level > 0)
      .sort((left, right) => right - left);
  }

  private async resolveWalletPlanet(wallet: Address, selectedPlanetId?: bigint): Promise<WalletSettlement> {
    if (!selectedPlanetId) return this.getGameSettlement(wallet);

    assertAddress(wallet);
    const [settlement, planet] = await Promise.all([
      this.getGameSettlement(wallet),
      this.getPlanet(selectedPlanetId)
    ]);
    if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) {
      return {
        wallet,
        hasFirstPlanet: settlement.hasFirstPlanet,
        homePlanetId: null,
        planet: null,
        contractKind: "game"
      };
    }

    return {
      wallet,
      hasFirstPlanet: settlement.hasFirstPlanet,
      homePlanetId: planet.planetId,
      planet,
      contractKind: "game"
    };
  }

  private async readPlanetName(planetId: bigint): Promise<string | null> {
    try {
      const value = decodeStringResult(await this.call("0xec16d865", [encodeUint(planetId)]));
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private async readMoonSummary(planetId: bigint): Promise<{ exists: boolean } | null> {
    if (!this.moonContractAddress) return null;
    try {
      const moon = await this.readMoon(planetId);
      return { exists: moon.exists };
    } catch (error) {
      if (isRpcRevert(error)) return null;
      throw error;
    }
  }

  private async readOptionalUintCall(selector: string, args: string[]): Promise<bigint | null> {
    try {
      return await this.readUintCall(selector, args);
    } catch (error) {
      if (isRpcRevert(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readErc20Uint(tokenAddress: Address, selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.callContract(tokenAddress, selector, args)), 0));
  }

  private async getCompactSettlement(wallet: Address): Promise<WalletSettlement> {
    if (!this.settlementContractAddress) {
      return {
        wallet,
        hasFirstPlanet: false,
        homePlanetId: null,
        planet: null,
        contractKind: "settlement"
      };
    }

    const hasFirstPlanet = decodeBoolWord(
      wordAt(splitWords(await this.compactCall("0x1d750846", [encodeAddress(wallet)])), 0)
    );

    if (!hasFirstPlanet) {
      return {
        wallet,
        hasFirstPlanet: false,
        homePlanetId: null,
        planet: null,
        contractKind: "settlement"
      };
    }

    const words = splitWords(await this.compactCall("0x29147f24", [encodeAddress(wallet)]));
    const galaxy = Number(decodeUintWord(wordAt(words, 0)));
    const system = Number(decodeUintWord(wordAt(words, 1)));
    const position = Number(decodeUintWord(wordAt(words, 2)));
    const settledAt = decodeUintWord(wordAt(words, 5)).toString();
    const metadata = planetMetadata(this.chainId, this.settlementContractAddress, { galaxy, system, position });

    return {
      wallet,
      hasFirstPlanet: true,
      homePlanetId: null,
      planet: {
        planetId: `${galaxy}:${system}:${position}`,
        owner: wallet,
        name: null,
        galaxy,
        system,
        position,
        fields: metadata.fields,
        temperature: metadata.temperature,
        metalMultiplierBps: metadata.metalMultiplierBps,
        crystalMultiplierBps: metadata.crystalMultiplierBps,
        deuteriumMultiplierBps: metadata.deuteriumMultiplierBps,
        lastSettledAt: settledAt,
        resources: zeroResources()
      },
      contractKind: "settlement"
    };
  }

  private async readResources(selector: string, firstArg: bigint): Promise<Resources> {
    return decodeResources(splitWords(await this.call(selector, [encodeUint(firstArg)])));
  }

  private async readOptionalResources(selector: string, firstArg: bigint): Promise<Resources | null> {
    try {
      return await this.readResources(selector, firstArg);
    } catch (error) {
      if (isRpcRevert(error)) return null;
      throw error;
    }
  }

  private async readEnergyBalance(planetId: bigint): Promise<EnergyBalance> {
    const words = splitWords(await this.call("0x7938100c", [encodeUint(planetId)]));
    return {
      produced: decodeUintWord(wordAt(words, 0)).toString(),
      required: decodeUintWord(wordAt(words, 1)).toString(),
      scaleBps: decodeUintWord(wordAt(words, 2)).toString()
    };
  }

  private async readResourcesCall(selector: string, args: string[]): Promise<Resources> {
    return decodeResources(splitWords(await this.call(selector, args)));
  }

  private async readMoonResourcesCall(selector: string, args: string[]): Promise<Resources> {
    return decodeResources(splitWords(await this.moonCall(selector, args)));
  }

  private async readUintCall(selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.call(selector, args)), 0));
  }

  private async readMoonUintCall(selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.moonCall(selector, args)), 0));
  }

  private async call(selector: string, args: string[]): Promise<string> {
    return this.callContract(this.gameContractAddress, selector, args);
  }

  private async moonCall(selector: string, args: string[]): Promise<string> {
    return this.callContract(this.moonContractAddress ?? this.gameContractAddress, selector, args);
  }

  private async compactCall(selector: string, args: string[]): Promise<string> {
    if (!this.settlementContractAddress) {
      throw new Error("Veydrift settlement contract address is required.");
    }

    return this.callContract(this.settlementContractAddress, selector, args);
  }

  private async readFleetMissionSummaries(): Promise<FleetMissionSummary[]> {
    const missionLogs = await this.getLogs({
      address: this.gameContractAddress,
      fromBlock: toQuantity(this.indexFromBlock),
      toBlock: "latest",
      topics: [[
        fleetMissionLaunchedTopic,
        fleetMissionCargoTopic,
        fleetMissionShipsTopic,
        fleetMissionRecalledTopic,
        fleetMissionResolvedTopic,
        fleetMissionReturnExposedTopic,
        attackMissionJoinedTopic
      ]]
    });
    const missions = decodeFleetMissionLogs(missionLogs);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    return [...missions.values()]
      .filter(isCompleteFleetMissionSummary)
      .map((mission) => ({
        ...mission,
        needsResolution: mission.status === "Outbound" && Number(mission.arrivalAt) <= nowSeconds
      }));
  }

  private async callContract(contractAddress: Address, selector: string, args: string[]): Promise<string> {
    return this.transport.request<string>("eth_call", [
      {
        to: contractAddress,
        data: `${selector}${args.join("")}`
      },
      "latest"
    ]);
  }

  private async batchCallContract(
    contractAddress: Address,
    calls: Array<{ selector: string; args: string[] }>
  ): Promise<string[]> {
    if (calls.length === 0) return [];
    if (calls.length > maxBatchCallSize) {
      const results: string[] = [];
      for (let index = 0; index < calls.length; index += maxBatchCallSize) {
        results.push(...await this.batchCallContract(contractAddress, calls.slice(index, index + maxBatchCallSize)));
      }
      return results;
    }

    const runSequentially = async (): Promise<string[]> => {
      const results: string[] = [];
      for (const call of calls) {
        results.push(await this.callContract(contractAddress, call.selector, call.args));
      }
      return results;
    };

    if (!this.transport.requestBatch) {
      return runSequentially();
    }

    try {
      return await this.transport.requestBatch<string>(calls.map((call) => ({
        method: "eth_call",
        params: [
          {
            to: contractAddress,
            data: `${call.selector}${call.args.join("")}`
          },
          "latest"
        ]
      })));
    } catch (error) {
      if (!shouldRetryWithoutBatch(error)) {
        throw error;
      }
      return runSequentially();
    }
  }
}

export type MutableFleetMissionSummary = Partial<FleetMissionSummary> & { missionId: string };

export function decodeFleetMissionLogs(logs: RpcLog[]): Map<string, MutableFleetMissionSummary> {
  const missions = new Map<string, MutableFleetMissionSummary>();
  for (const log of logs) {
    const topic = topicAt(log.topics, 0);
    if (topic === attackMissionJoinedTopic) {
      const attackMissionId = decodeUint(topicAt(log.topics, 1)).toString();
      const joinedMissionId = decodeUint(topicAt(log.topics, 2)).toString();
      const attack = missions.get(attackMissionId) ?? {
        missionId: attackMissionId,
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        ships: {},
        fuelCost: "0",
        recallCost: null,
        attackGroupId: attackMissionId,
        joinedAttackMissionIds: [],
        needsResolution: false,
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber).toString()
      };
      attack.attackGroupId = attackMissionId;
      attack.joinedAttackMissionIds = [
        ...new Set([...(attack.joinedAttackMissionIds ?? []), joinedMissionId])
      ];
      missions.set(attackMissionId, attack);

      const joined = missions.get(joinedMissionId) ?? {
        missionId: joinedMissionId,
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        ships: {},
        fuelCost: "0",
        recallCost: null,
        attackGroupId: attackMissionId,
        joinedAttackMissionIds: [],
        needsResolution: false,
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber).toString()
      };
      joined.attackGroupId = attackMissionId;
      missions.set(joinedMissionId, joined);
      continue;
    }

    const missionId = decodeUint(topicAt(log.topics, 1)).toString();
    const mission = missions.get(missionId) ?? {
      missionId,
      cargo: { metal: "0", crystal: "0", deuterium: "0" },
      ships: {},
      fuelCost: "0",
      recallCost: null,
      attackGroupId: null,
      joinedAttackMissionIds: [],
      needsResolution: false,
      transactionHash: log.transactionHash,
      blockNumber: BigInt(log.blockNumber).toString()
    };
    mission.transactionHash = log.transactionHash;
    mission.blockNumber = BigInt(log.blockNumber).toString();

    if (topic === fleetMissionLaunchedTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.missionType = missionTypeLabel(decodeUint(topicAt(log.topics, 3)));
      mission.status = "Outbound";
      mission.originPlanetId = decodeUintWord(wordAt(words, 0)).toString();
      mission.targetPlanetId = decodeUintWord(wordAt(words, 1)).toString();
      mission.arrivalAt = decodeUintWord(wordAt(words, 2)).toString();
      mission.returnAt = decodeUintWord(wordAt(words, 3)).toString();
      if (mission.missionType === "AcsAttack") {
        const attackMissionId = decodeUintWord(wordAt(words, 4)).toString();
        mission.attackGroupId = attackMissionId;
        const attack = missions.get(attackMissionId) ?? {
          missionId: attackMissionId,
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
          ships: {},
          fuelCost: "0",
          recallCost: null,
          attackGroupId: attackMissionId,
          joinedAttackMissionIds: [],
          needsResolution: false,
          transactionHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber).toString()
        };
        attack.attackGroupId = attackMissionId;
        attack.joinedAttackMissionIds = [
          ...new Set([...(attack.joinedAttackMissionIds ?? []), missionId])
        ];
        missions.set(attackMissionId, attack);
      }
    } else if (topic === fleetMissionCargoTopic) {
      const words = splitWords(log.data);
      mission.cargo = decodeResources(words.slice(0, 3));
      mission.fuelCost = decodeUintWord(wordAt(words, 3)).toString();
    } else if (topic === fleetMissionShipsTopic) {
      const words = splitWords(log.data);
      mission.ships = Object.fromEntries([
        "smallCargo",
        "lightFighter",
        "recycler",
        "colonyShip",
        "largeCargo",
        "heavyFighter",
        "cruiser",
        "battleship",
        "bomber",
        "destroyer",
        "deathstar",
        "battlecruiser",
        "reaper",
        "pathfinder"
      ].map((key, index) => [key, decodeUintWord(wordAt(words, index)).toString()]));
    } else if (topic === fleetMissionRecalledTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.status = "Recalled";
      mission.returnAt = decodeUintWord(wordAt(words, 0)).toString();
      mission.recallCost = decodeUintWord(wordAt(words, 1)).toString();
    } else if (topic === fleetMissionResolvedTopic) {
      mission.returnAt = decodeUintWord(wordAt(splitWords(log.data), 0)).toString();
      mission.status = "Resolved";
    } else if (topic === fleetMissionReturnExposedTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.status = missionStatusLabel(decodeUint(topicAt(log.topics, 3)));
      mission.originPlanetId = decodeUintWord(wordAt(words, 0)).toString();
      mission.targetPlanetId = decodeUintWord(wordAt(words, 1)).toString();
      mission.returnAt = decodeUintWord(wordAt(words, 2)).toString();
      mission.cargo = decodeResources(words.slice(3, 6));
    }

    missions.set(missionId, mission);
  }

  return missions;
}

export function decodeCompleteFleetMissionLogs(logs: RpcLog[]): FleetMissionSummary[] {
  return [...decodeFleetMissionLogs(logs).values()].filter(isCompleteFleetMissionSummary);
}

function isCompleteFleetMissionSummary(mission: MutableFleetMissionSummary): mission is FleetMissionSummary {
  return Boolean(
    mission.status
      && mission.missionType
      && mission.owner
      && mission.originPlanetId
      && mission.targetPlanetId
      && mission.arrivalAt
      && mission.returnAt
      && mission.fuelCost !== undefined
      && mission.attackGroupId !== undefined
      && mission.joinedAttackMissionIds
      && mission.cargo
      && mission.ships
      && mission.transactionHash
      && mission.blockNumber
      && mission.needsResolution !== undefined
  );
}

function missionTypeLabel(value: bigint): string {
  return missionTypes[Number(value)] ?? `Unknown:${value.toString()}`;
}

function missionStatusLabel(value: bigint): string {
  return missionStatuses[Number(value)] ?? `Unknown:${value.toString()}`;
}

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const maxBatchCallSize = 50;
const buildingCount = 16;
const defenseCount = 10;
const supportedShipIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const supportedTechnologyIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const riftBuildingId = 15;
const riftWithdrawalDelaySeconds = 30 * 24 * 60 * 60;
const riftResourceCatalog: Array<Pick<RiftResourceState, "key" | "label" | "resourceId">> = [
  { key: "metal", label: "Metal", resourceId: 0 },
  { key: "crystal", label: "Crystal", resourceId: 1 },
  { key: "deuterium", label: "Deuterium", resourceId: 2 }
];
const moonBuildingCatalog: Array<Pick<MoonState["buildings"][number], "id" | "key" | "label">> = [
  { id: 0, key: "lunarBase", label: "Lunar Base" },
  { id: 2, key: "jumpGate", label: "Jump Gate" }
];
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const colonyCreatedTopic = "0xd7d717f6607ff051c7f2247d5c490eb9ece607b9ee7c7eee946898025815cfc0";
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const planetRenamedTopic = "0x2b772c1fa271aad466ce009b6b5824b2ad6ccd942d21efc686513ffa8eb166cd";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const buildingCompletedTopic = "0xa2543cf02e1a3601ccdc4fff81d99ff1225eaf4ad629fbd0f724d61db252c370";
const defenseQueuedTopic = "0xc3dcdf6abcac9fc4831745727e78f808922f43da079b984420ef70c97cff0f5b";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const debrisFieldUpdatedTopic = "0x49f79a15c2a0409be62598b886efd90e25154bb9156b4bd64df41fd515aa4909";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionRecalledTopic = "0x2c9b31f1abc732f3b6d28e7724439ea4713ae516632088b8c4dc0211479dc6ca";
const fleetMissionResolvedTopic = "0xcb928b431ffcdbe55fddc2bf06967951efb3dfe87d14bc436d546fdbbee9cb2d";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const attackMissionJoinedTopic = "0xc584e0cc52df45c2a92cc5556e493377d69bfe3e3658d1adb13f27cfcc89b146";
const missionTypes = ["Transport", "Deploy", "Colonize", "Attack", "Harvest", "AcsDefend", "Intercept", "MissileAttack", "AcsAttack"] as const;
const missionStatuses = ["None", "Outbound", "Returning", "Resolved", "Returned", "Recalled"] as const;
const moonChanceRequestedTopic = "0x8969f3a52192b4b918b49219d60ea0b68d3f5fd8b70c4691b297a538ac333121";
const moonChanceFinalizedTopic = "0xd485b8634099625ba076107f73a9ea0e95b3f6ac18d76e501b618572e6705d04";
const moonChanceSkippedExistingMoonTopic =
  "0x93793f9a66f3a0a4cea93b7eb92e142d7283b5b33f657e14277879f2f8e7ab4e";
const moonDestructionRequestedTopic = "0x719ab77026e22a766a85f5c32e5294b20e76b8a0490812761ab98ab3a1739884";
const moonDestructionFinalizedTopic = "0xdac71b69e1912e36573457fd7e6227e8b5ac86e9e011bd7eddc6c104221ed803";
const moonCreatedTopic = "0x395ddd11cfc613034fc4941029df5968212af4a52ba611d84d3257824c81f4a4";
const moonBuildingStartedTopic = "0x6b41aeb096e643752dad879b8f3875d8657186226c3cf8b6e7a38c27292f215a";
const moonBuildingCompletedTopic = "0x59b630c46c04307254808aac61ea2de2a7e6fbf5ed6eb0ebee81c917b575ed3a";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
const marketResourceWithdrawalRequestedTopic = "0xc4694dfe978480c576eacc57b2b09e69c8b8f50c49739ca4c4515295be589eab";
const marketResourceWithdrawalFinishedTopic = "0x2b254e656a481b3978a707e6846146a1d7a3144e414cb803bbc7adc97d7587ee";

export function assertAddress(address: string): asserts address is Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid EVM address.");
  }
}

function emptyRiftState(wallet: Address, homePlanetId: string | null, unavailableReason: string): RiftState {
  return {
    wallet,
    homePlanetId,
    riftAvailable: false,
    unlocked: false,
    unavailableReason,
    withdrawalDelaySeconds: riftWithdrawalDelaySeconds.toString(),
    requirements: riftRequirements(null, 0, 0, {}),
    resources: riftResourceCatalog.map((resource) => ({
      ...resource,
      tokenAddress: null,
      walletBalance: null,
      allowance: null,
      inGameBalance: "0",
      lockedBalance: "0"
    })),
    pendingWithdrawals: []
  };
}

function emptyMoonState(wallet: Address, homePlanetId: string | null, unavailableReason: string): MoonState {
  return {
    wallet,
    homePlanetId,
    moonAvailable: false,
    unavailableReason,
    moon: null,
    buildings: moonBuildingCatalog.map((building) => ({
      ...building,
      level: 0,
      cost: zeroResources()
    })),
    queue: null
  };
}

export function riftRequirements(
  riftBuilt: boolean | null,
  roboticsLevel: number,
  researchLabLevel: number,
  technologyLevels: Record<string, number>
): RiftRequirement[] {
  return [
    {
      kind: "building",
      key: "interdimensionalRiftStabilizer",
      label: "Interdimensional Rift Stabilizer",
      currentLevel: riftBuilt === null ? null : riftBuilt ? 1 : 0,
      requiredLevel: 1,
      binary: true,
      built: riftBuilt
    },
    {
      kind: "building",
      key: "roboticsFactory",
      label: "Robotics Factory",
      currentLevel: roboticsLevel,
      requiredLevel: 4
    },
    {
      kind: "building",
      key: "researchLab",
      label: "Research Lab",
      currentLevel: researchLabLevel,
      requiredLevel: 2
    },
    {
      kind: "technology",
      key: "energy",
      label: "Energy Technology",
      currentLevel: technologyLevels["0"] ?? 0,
      requiredLevel: 5
    },
    {
      kind: "technology",
      key: "hyperspace",
      label: "Hyperspace Technology",
      currentLevel: technologyLevels["9"] ?? 0,
      requiredLevel: 1
    },
  ];
}

export function isSettledPlanetLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === planetStartedTopic || topic === colonyCreatedTopic;
}

export function isPlanetSettledLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetSettledTopic;
}

export function isPlanetRenamedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetRenamedTopic;
}

export function isDebrisFieldLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === debrisFieldUpdatedTopic;
}

export function isShipCountChangedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetShipCountChangedTopic;
}

export function isIndexedQueueStartedLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === buildingStartedTopic
    || topic === defenseQueuedTopic
    || topic === shipQueuedTopic
    || topic === researchQueuedTopic
    || topic === moonBuildingStartedTopic;
}

export function isIndexedQueueCompletedLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === buildingCompletedTopic
    || topic === defenseCompletedTopic
    || topic === shipCompletedTopic
    || topic === researchCompletedTopic
    || topic === moonBuildingCompletedTopic;
}

export function isMoonCreatedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === moonCreatedTopic;
}

export function isRiftResourceLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === marketResourceDepositedTopic
    || topic === marketResourceWithdrawalRequestedTopic
    || topic === marketResourceWithdrawalFinishedTopic;
}

export function isFleetMissionLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === fleetMissionLaunchedTopic
    || topic === fleetMissionCargoTopic
    || topic === fleetMissionShipsTopic
    || topic === fleetMissionRecalledTopic
    || topic === fleetMissionResolvedTopic
    || topic === fleetMissionReturnExposedTopic
    || topic === fleetMissionReturnedTopic
    || topic === attackMissionJoinedTopic;
}

export function decodeSettledPlanetLog(log: RpcLog): SettledPlanetEvent {
  const eventName = topicAt(log.topics, 0) === planetStartedTopic ? "PlanetStarted" : "ColonyCreated";
  const player = decodeAddressWord(topicAt(log.topics, 1));
  const planetId = decodeUint(topicAt(log.topics, eventName === "PlanetStarted" ? 2 : 3));
  const words = splitWords(log.data);
  const fields = Number(decodeUintWord(wordAt(words, 3)));
  const temperature = Number(decodeSignedWord(wordAt(words, 4)));
  const multipliers = planetMultipliers(temperature, fields);

  return {
    eventName,
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: planetId.toString(),
    owner: player,
    name: null,
    galaxy: Number(decodeUintWord(wordAt(words, 0))),
    system: Number(decodeUintWord(wordAt(words, 1))),
    position: Number(decodeUintWord(wordAt(words, 2))),
    fields,
    temperature,
    ...multipliers,
    lastSettledAt: "0",
    resources: {
      metal: "0",
      crystal: "0",
      deuterium: "0"
    }
  };
}

export function decodePlanetSettledLog(log: RpcLog): PlanetSettledEvent {
  const words = splitWords(log.data);

  return {
    eventName: "PlanetSettled",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    resources: decodeResources(words.slice(0, 3)),
    lastSettledAt: decodeUintWord(wordAt(words, 3)).toString()
  };
}

export function decodeShipCountChangedLog(log: RpcLog): IndexedShipCountChangedEvent {
  const words = splitWords(log.data);

  return {
    eventName: "PlanetShipCountChanged",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    shipId: Number(decodeUint(topicAt(log.topics, 2))),
    total: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodePlanetRenamedLog(log: RpcLog): PlanetRenamedEvent {
  return {
    eventName: "PlanetRenamed",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    owner: decodeAddressWord(topicAt(log.topics, 1)),
    planetId: decodeUint(topicAt(log.topics, 2)).toString(),
    name: decodeStringResult(log.data)
  };
}

export function decodeIndexedQueueStartedLog(log: RpcLog): IndexedQueueStartedEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    readyAt: decodeUintWord(wordAt(words, 1)).toString(),
    cost: decodeResources(words.slice(2, 5))
  };

  if (topic === researchQueuedTopic) {
    return {
      ...base,
      eventName: "ResearchQueued",
      queueKind: "research",
      owner: decodeAddressWord(topicAt(log.topics, 1)),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      targetLevel: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === moonBuildingStartedTopic) {
    return {
      ...base,
      eventName: "MoonBuildingStarted",
      queueKind: "moon-building",
      planetId: decodeUint(topicAt(log.topics, 1)).toString(),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      targetLevel: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  const planetId = decodeUint(topicAt(log.topics, 1)).toString();
  const itemId = Number(decodeUint(topicAt(log.topics, 2)));
  if (topic === buildingStartedTopic) {
    return {
      ...base,
      eventName: "BuildingStarted",
      queueKind: "building",
      planetId,
      itemId,
      targetLevel: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === defenseQueuedTopic) {
    return {
      ...base,
      eventName: "DefenseQueued",
      queueKind: "defense",
      planetId,
      itemId,
      quantity: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  return {
    ...base,
    eventName: "ShipQueued",
    queueKind: "ship",
    planetId,
    itemId,
    quantity: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodeIndexedQueueCompletedLog(log: RpcLog): IndexedQueueCompletedEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString()
  };

  if (topic === researchCompletedTopic) {
    return {
      ...base,
      eventName: "ResearchCompleted",
      queueKind: "research",
      owner: decodeAddressWord(topicAt(log.topics, 1)),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      level: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === moonBuildingCompletedTopic) {
    return {
      ...base,
      eventName: "MoonBuildingCompleted",
      queueKind: "moon-building",
      planetId: decodeUint(topicAt(log.topics, 1)).toString(),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      level: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  const planetId = decodeUint(topicAt(log.topics, 1)).toString();
  const itemId = Number(decodeUint(topicAt(log.topics, 2)));
  if (topic === buildingCompletedTopic) {
    return {
      ...base,
      eventName: "BuildingCompleted",
      queueKind: "building",
      planetId,
      itemId,
      level: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === defenseCompletedTopic) {
    return {
      ...base,
      eventName: "DefenseCompleted",
      queueKind: "defense",
      planetId,
      itemId,
      quantity: Number(decodeUintWord(wordAt(words, 0))),
      total: Number(decodeUintWord(wordAt(words, 1)))
    };
  }

  return {
    ...base,
    eventName: "ShipCompleted",
    queueKind: "ship",
    planetId,
    itemId,
    quantity: Number(decodeUintWord(wordAt(words, 0))),
    total: Number(decodeUintWord(wordAt(words, 1)))
  };
}

export function decodeMoonCreatedLog(log: RpcLog): IndexedMoonCreatedEvent {
  const words = splitWords(log.data);
  return {
    eventName: "MoonCreated",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    owner: decodeAddressWord(topicAt(log.topics, 1)),
    planetId: decodeUint(topicAt(log.topics, 2)).toString(),
    galaxy: Number(decodeUintWord(wordAt(words, 0))),
    system: Number(decodeUintWord(wordAt(words, 1))),
    position: Number(decodeUintWord(wordAt(words, 2))),
    fields: Number(decodeUintWord(wordAt(words, 3))),
    diameterKm: Number(decodeUintWord(wordAt(words, 4))),
    createdAt: BigInt(log.blockNumber).toString()
  };
}

export function decodeRiftResourceLog(log: RpcLog): IndexedRiftResourceEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    owner: decodeAddressWord(topicAt(log.topics, 1)),
    planetId: decodeUint(topicAt(log.topics, 2)).toString(),
    resourceId: Number(decodeUint(topicAt(log.topics, 3))),
    amount: decodeUintWord(wordAt(words, 0)).toString()
  };

  if (topic === marketResourceWithdrawalRequestedTopic) {
    return {
      ...base,
      eventName: "MarketResourceWithdrawalRequested",
      unlocksAt: decodeUintWord(wordAt(words, 1)).toString()
    };
  }

  return {
    ...base,
    eventName: topic === marketResourceDepositedTopic
      ? "MarketResourceDeposited"
      : "MarketResourceWithdrawalFinished"
  };
}

export function isMoonChanceReportLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === moonChanceRequestedTopic
    || topic === moonChanceFinalizedTopic
    || topic === moonChanceSkippedExistingMoonTopic
    || topic === moonDestructionRequestedTopic
    || topic === moonDestructionFinalizedTopic;
}

export function decodeMoonChanceReportLog(log: RpcLog): MoonChanceReportEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString()
  };

  if (topic === moonChanceRequestedTopic) {
    return {
      ...base,
      eventName: "MoonChanceRequested",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      defender: decodeAddressWord(wordAt(words, 0)),
      metalDebris: decodeUintWord(wordAt(words, 1)).toString(),
      crystalDebris: decodeUintWord(wordAt(words, 2)).toString(),
      chanceBps: Number(decodeUintWord(wordAt(words, 3))),
      randomnessRequestId: decodeUintWord(wordAt(words, 4)).toString(),
      purposeHash: `0x${wordAt(words, 5)}`
    };
  }

  if (topic === moonChanceFinalizedTopic) {
    return {
      ...base,
      eventName: "MoonChanceFinalized",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      chanceBps: Number(decodeUintWord(wordAt(words, 0))),
      moonCreated: decodeBoolWord(wordAt(words, 1)),
      randomWord: decodeUintWord(wordAt(words, 2)).toString(),
      moonFields: Number(decodeUintWord(wordAt(words, 3))),
      moonDiameterKm: Number(decodeUintWord(wordAt(words, 4)))
    };
  }

  if (topic === moonDestructionRequestedTopic) {
    return {
      ...base,
      eventName: "MoonDestructionRequested",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      attacker: decodeAddressWord(wordAt(words, 0)),
      deathstars: Number(decodeUintWord(wordAt(words, 1))),
      moonDestructionChanceBps: Number(decodeUintWord(wordAt(words, 2))),
      deathstarDestructionChanceBps: Number(decodeUintWord(wordAt(words, 3))),
      randomnessRequestId: decodeUintWord(wordAt(words, 4)).toString(),
      purposeHash: `0x${wordAt(words, 5)}`
    };
  }

  if (topic === moonDestructionFinalizedTopic) {
    return {
      ...base,
      eventName: "MoonDestructionFinalized",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      moonDestroyed: decodeBoolWord(wordAt(words, 0)),
      deathstarsDestroyed: decodeBoolWord(wordAt(words, 1)),
      randomWord: decodeUintWord(wordAt(words, 2)).toString()
    };
  }

  return {
    ...base,
    eventName: "MoonChanceSkippedExistingMoon",
    battleId: decodeUint(topicAt(log.topics, 1)).toString(),
    targetPlanetId: decodeUint(topicAt(log.topics, 2)).toString(),
    metalDebris: decodeUintWord(wordAt(words, 0)).toString(),
    crystalDebris: decodeUintWord(wordAt(words, 1)).toString()
  };
}

export function decodeDebrisFieldLog(log: RpcLog): DebrisFieldEvent {
  const planetId = decodeUint(topicAt(log.topics, 1));
  const words = splitWords(log.data);

  return {
    eventName: "DebrisFieldUpdated",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: planetId.toString(),
    resources: {
      metal: decodeUintWord(wordAt(words, 0)).toString(),
      crystal: decodeUintWord(wordAt(words, 1)).toString()
    }
  };
}

function isMatchingBuildingStartedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.targetLevel
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function isMatchingDefenseQueuedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.quantity
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function isMatchingResearchQueuedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.targetLevel
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function encodeAddress(address: Address): string {
  assertAddress(address);
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function toQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function toTopic(value: bigint): string {
  return `0x${encodeUint(value)}`;
}

function toAddressTopic(address: Address): string {
  return `0x${encodeAddress(address)}`;
}

function splitWords(hex: string): string[] {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  const words: string[] = [];
  for (let index = 0; index < data.length; index += 64) {
    words.push(data.slice(index, index + 64).padStart(64, "0"));
  }
  return words;
}

function wordAt(words: string[], index: number): string {
  const word = words[index];
  if (!word) {
    throw new Error("RPC response did not contain enough ABI words.");
  }

  return word;
}

function topicAt(topics: string[], index: number): string {
  const topic = topics[index];
  if (!topic) {
    throw new Error("RPC log did not contain enough topics.");
  }

  return topic;
}

function decodeUint(hex: string): bigint {
  return BigInt(hex);
}

function decodeUintWord(word: string): bigint {
  return BigInt(`0x${word}`);
}

function decodeSignedWord(word: string): bigint {
  return BigInt.asIntN(256, BigInt(`0x${word}`));
}

function decodeBoolWord(word: string): boolean {
  return decodeUintWord(word) !== 0n;
}

function decodeAddressWord(word: string): Address {
  return `0x${word.slice(-40)}` as Address;
}

function decodeStringResult(hex: string): string {
  const words = splitWords(hex);
  const offset = Number(decodeUintWord(wordAt(words, 0)) / 32n);
  const length = Number(decodeUintWord(wordAt(words, offset)));
  const data = words.slice(offset + 1).join("").slice(0, length * 2);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    bytes[index] = Number.parseInt(data.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function decodeNullableStringResult(hex: string): string | null {
  try {
    const value = decodeStringResult(hex);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function decodeString(words: string[], headIndex: number, baseIndex = 0): string {
  const offset = baseIndex + Number(decodeUintWord(wordAt(words, headIndex))) / 32;
  const length = Number(decodeUintWord(wordAt(words, offset)));
  let hex = "";
  for (let index = offset + 1; hex.length < length * 2; index += 1) {
    hex += wordAt(words, index);
  }
  return new TextDecoder().decode(hexToBytes(hex.slice(0, length * 2)));
}

function decodeAddressArray(hex: string): Address[] {
  const words = splitWords(hex);
  const offset = Number(decodeUintWord(wordAt(words, 0))) / 32;
  const length = Number(decodeUintWord(wordAt(words, offset)));
  return Array.from({ length }, (_, index) => decodeAddressWord(wordAt(words, offset + 1 + index)));
}

function decodeUintArray(hex: string): bigint[] {
  const words = splitWords(hex);
  const offset = Number(decodeUintWord(wordAt(words, 0))) / 32;
  const length = Number(decodeUintWord(wordAt(words, offset)));
  return Array.from({ length }, (_, index) => decodeUintWord(wordAt(words, offset + 1 + index)));
}

function decodeAllianceDirectoryEntry(allianceId: bigint, words: string[]): AllianceState["directory"][number] {
  const tupleStart = dynamicTupleStart(words);
  return {
    allianceId: allianceId.toString(),
    active: decodeBoolWord(wordAt(words, tupleStart)),
    tag: decodeString(words, tupleStart + 1, tupleStart),
    name: decodeString(words, tupleStart + 2, tupleStart),
    description: decodeString(words, tupleStart + 3, tupleStart),
    owner: decodeAddressWord(wordAt(words, tupleStart + 4)),
    createdAt: decodeUintWord(wordAt(words, tupleStart + 5)).toString(),
    memberCount: Number(decodeUintWord(wordAt(words, tupleStart + 6)))
  };
}

function dynamicTupleStart(words: string[]): number {
  if (words.length < 2) return 0;

  const offset = Number(decodeUintWord(wordAt(words, 0)) / 32n);
  return offset > 0 && offset < words.length ? offset : 0;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function allianceRoleName(role: number): AllianceRoleName {
  if (role === 1) return "member";
  if (role === 2) return "officer";
  if (role === 3) return "owner";
  return "none";
}

export function attackBlockReasonLabel(reason: AttackBlockReason): string | null {
  if (reason === "bashing_limit") {
    return "Attack blocked: bashing limit reached for this attacker, defender, and planet in the current 24-hour window.";
  }
  if (reason === "score_protection") {
    return "Attack blocked: target is protected by newbie or score-ratio protection.";
  }
  if (reason === "same_alliance") {
    return "Attack blocked: target belongs to your alliance.";
  }
  return null;
}

function decodeAttackBlockReason(reason: number): AttackBlockReason {
  if (reason === 1) return "bashing_limit";
  if (reason === 2) return "score_protection";
  if (reason === 3) return "same_alliance";
  return "none";
}

function decodeAttackRelation(flags: number): AttackRelation {
  if ((flags & 1) !== 0) return "stronger";
  if ((flags & 2) !== 0) return "weaker";
  return "peer";
}

function decodeHonorStatus(flags: number): HonorStatus {
  if ((flags & 8) !== 0) return "bandit";
  if ((flags & 4) !== 0) return "honorable";
  return "neutral";
}

function decodeResources(words: string[]): Resources {
  return {
    metal: decodeUintWord(words[0] ?? "0").toString(),
    crystal: decodeUintWord(words[1] ?? "0").toString(),
    deuterium: decodeUintWord(words[2] ?? "0").toString()
  };
}

function zeroResources(): Resources {
  return {
    metal: "0",
    crystal: "0",
    deuterium: "0"
  };
}

function isRpcRevert(error: unknown): boolean {
  return error instanceof Error && /execution reverted|revert|missing revert data/i.test(error.message);
}

function shouldChunkLogQuery(error: unknown): boolean {
  return error instanceof Error && /max block range|block range|too many blocks|RPC HTTP 400/i.test(error.message);
}

function shouldRetryWithoutBatch(error: unknown): boolean {
  return error instanceof Error && /RPC HTTP (400|413)/i.test(error.message);
}

function isRetryableRpcHttpStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function isRetryableRpcError(error: { code: number; message: string }): boolean {
  return /over rate limit|rate limit|too many requests/i.test(error.message);
}

function retryDelay(attempt: number): Promise<void> {
  return retryDelayMs(300 * (attempt + 1));
}

function retryDelayMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
