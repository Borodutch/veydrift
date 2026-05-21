import type { BackendConfig } from "./config";
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
  fields: number;
  temperature: number;
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
  lastSettledAt: string;
  resources: Resources;
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

export type ShipyardState = {
  wallet: Address;
  homePlanetId: string | null;
  productionAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  shipyardLevel: number;
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
  buildings: Array<{
    id: number;
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

export type SettledPlanetEvent = PlanetState & {
  eventName: "PlanetStarted" | "ColonyCreated";
  transactionHash: string;
  blockNumber: string;
};

export interface ChainReader {
  getWalletSettlement(wallet: Address): Promise<WalletSettlement>;
  getPlanet(planetId: bigint): Promise<PlanetState | null>;
  getPlayerQueues(wallet: Address): Promise<PlayerQueues>;
  getInfrastructureState(wallet: Address): Promise<InfrastructureState>;
  getDefenseState(wallet: Address): Promise<DefenseState>;
  getShipyardState(wallet: Address): Promise<ShipyardState>;
  getResearchState(wallet: Address): Promise<ResearchState>;
  getRiftState(wallet: Address): Promise<RiftState>;
  listSettledPlanetEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<SettledPlanetEvent[]>;
}

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type RpcLog = {
  blockNumber: string;
  transactionHash: string;
  topics: string[];
  data: string;
};

type RpcBlock = {
  timestamp: string;
};

export class HttpJsonRpcTransport {
  constructor(private readonly rpcUrl: string) {}

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.rpcUrl, {
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
      throw new Error(`RPC HTTP ${response.status}`);
    }

    const body = (await response.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
    }

    if (body.result === undefined) {
      throw new Error("RPC response missing result.");
    }

    return body.result;
  }
}

export class VeydriftGameReader implements ChainReader {
  private readonly transport: Pick<HttpJsonRpcTransport, "request">;
  private readonly gameContractAddress: Address;
  private readonly chainId: number;
  private readonly indexFromBlock: bigint;
  private readonly resourceTokenAddresses: Partial<Record<RiftResourceKey, Address>>;
  private readonly settlementContractAddress: Address | undefined;

  constructor(config: BackendConfig, transport?: Pick<HttpJsonRpcTransport, "request">) {
    if (!config.rpcUrl) {
      throw new Error("RPC URL is required.");
    }
    if (!config.gameContractAddress) {
      throw new Error("VeydriftGame contract address is required.");
    }

    this.transport = transport ?? new HttpJsonRpcTransport(config.rpcUrl);
    this.gameContractAddress = config.gameContractAddress;
    this.chainId = config.chainId;
    this.indexFromBlock = config.indexFromBlock;
    this.resourceTokenAddresses = config.resourceTokenAddresses ?? {};
    this.settlementContractAddress = config.settlementContractAddress;
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

    return {
      planetId: planetId.toString(),
      owner,
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

  async getPlayerQueues(wallet: Address): Promise<PlayerQueues> {
    const settlement = await this.getGameSettlement(wallet);
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

  async getInfrastructureState(wallet: Address): Promise<InfrastructureState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.getGameSettlement(wallet);
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
        buildings: Array.from({ length: buildingCount }, (_, id) => ({
          id,
          level: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, productionPerHour, energyBalance, storageCaps, queue, buildings] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readResources("0x9ec5e0d5", planetId),
      this.readEnergyBalance(planetId),
      this.readResources("0x6db0ecd7", planetId),
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readBuildingRows(planetId)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      infrastructureAvailable: true,
      resources,
      productionPerHour,
      energyBalance,
      storageCaps,
      buildings,
      queue
    };
  }

  async getShipyardState(wallet: Address): Promise<ShipyardState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.getGameSettlement(wallet);
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
        shipyardLevel: 0,
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
        shipyardLevel: 0,
        technologyLevels: {},
        ships: Array.from({ length: shipCount }, (_, id) => ({
          id,
          count: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, shipyardLevel, queue, technologyLevels, ships] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
      this.readPlanetQueue("0xb6f4b7b7", planetId, "ship"),
      this.readTechnologyLevels(wallet),
      this.readShipRows(planetId)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      productionAvailable: true,
      resources,
      shipyardLevel: Number(shipyardLevel),
      technologyLevels,
      ships,
      queue
    };
  }

  async getDefenseState(wallet: Address): Promise<DefenseState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.getGameSettlement(wallet);
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
    const [resources, shipyardLevel, queue, technologyLevels, defenses] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
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
      technologyLevels,
      defenses,
      queue
    };
  }

  async getResearchState(wallet: Address): Promise<ResearchState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.getGameSettlement(wallet);
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
        technologyLevels: {},
        technologies: Array.from({ length: technologyCount }, (_, id) => ({
          id,
          level: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, researchLabLevel, queue, technologyLevels, technologies] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(6n)]),
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
      technologyLevels,
      technologies,
      queue
    };
  }

  async getRiftState(wallet: Address): Promise<RiftState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.getGameSettlement(wallet);
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

    const requirements = riftRequirements(
      riftLevel === null ? null : Number(riftLevel),
      Number(roboticsLevel),
      Number(researchLabLevel),
      technologyLevels
    );
    const unlocked = requirements.every((requirement) =>
      requirement.currentLevel !== null && requirement.currentLevel >= requirement.requiredLevel
    );
    const tokenAddressesConfigured = riftResourceCatalog.every((resource) => this.resourceTokenAddresses[resource.key]);
    const pendingWithdrawals = await this.readRiftWithdrawals(wallet);
    const resources = await this.readRiftResources(wallet, settlement.planet.resources, pendingWithdrawals);
    const unavailableReason = riftLevel === null
      ? "This deployment does not expose the Interdimensional Rift Stabilizer building yet."
      : !unlocked
        ? "Build the Interdimensional Rift Stabilizer and meet its prerequisites to unlock resource bridging."
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

  async listSettledPlanetEvents(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<SettledPlanetEvent[]> {
    const logs = await this.transport.request<RpcLog[]>("eth_getLogs", [
      {
        address: this.gameContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[planetStartedTopic, colonyCreatedTopic]]
      }
    ]);

    return logs.map((log) => decodeSettledPlanetLog(log));
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
    }

    return queue;
  }

  private async readBuildingStartedAt(planetId: bigint, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.targetLevel === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.transport.request<RpcLog[]>("eth_getLogs", [
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
      ]);
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

  private async readResearchQueue(wallet: Address): Promise<QueueState> {
    const words = splitWords(await this.call("0x2b98afc7", [encodeAddress(wallet)]));
    const active = decodeBoolWord(wordAt(words, 0));
    return {
      active,
      kind: active ? "research" : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      targetLevel: Number(decodeUintWord(wordAt(words, 2))),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };
  }

  private async readTechnologyLevels(wallet: Address): Promise<Record<string, number>> {
    const entries = await Promise.all(
      Array.from({ length: technologyCount }, async (_, id) => [
        id.toString(),
        Number(await this.readUintCall("0xe512884c", [encodeAddress(wallet), encodeUint(BigInt(id))]))
      ] as const)
    );

    return Object.fromEntries(entries);
  }

  private async readShipRows(planetId: bigint): Promise<ShipyardState["ships"]> {
    return Promise.all(
      Array.from({ length: shipCount }, async (_, id) => {
        const [count, cost] = await Promise.all([
          this.readUintCall("0x57686701", [encodeUint(planetId), encodeUint(BigInt(id))]),
          this.readResources("0xc4222030", BigInt(id))
        ]);

        return {
          id,
          count: Number(count),
          cost
        };
      })
    );
  }

  private async readDefenseRows(planetId: bigint): Promise<DefenseState["defenses"]> {
    return Promise.all(
      Array.from({ length: defenseCount }, async (_, id) => {
        const [count, cost] = await Promise.all([
          this.readUintCall("0x836e3a32", [encodeUint(planetId), encodeUint(BigInt(id))]),
          this.readResources("0x9b906295", BigInt(id))
        ]);

        return {
          id,
          count: Number(count),
          cost
        };
      })
    );
  }

  private async readBuildingRows(planetId: bigint): Promise<InfrastructureState["buildings"]> {
    return Promise.all(
      Array.from({ length: buildingCount }, async (_, id) => {
        const [level, cost] = await Promise.all([
          this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(BigInt(id))]),
          this.readResourcesCall("0x291ee1b5", [encodeUint(planetId), encodeUint(BigInt(id))])
        ]);

        return {
          id,
          level: Number(level),
          cost
        };
      })
    );
  }

  private async readTechnologyRows(wallet: Address): Promise<ResearchState["technologies"]> {
    return Promise.all(
      Array.from({ length: technologyCount }, async (_, id) => {
        const [level, cost] = await Promise.all([
          this.readUintCall("0xe512884c", [encodeAddress(wallet), encodeUint(BigInt(id))]),
          this.readResourcesCall("0x6e984888", [encodeAddress(wallet), encodeUint(BigInt(id))])
        ]);

        return {
          id,
          level: Number(level),
          cost
        };
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

  private async readUintCall(selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.call(selector, args)), 0));
  }

  private async call(selector: string, args: string[]): Promise<string> {
    return this.callContract(this.gameContractAddress, selector, args);
  }

  private async compactCall(selector: string, args: string[]): Promise<string> {
    if (!this.settlementContractAddress) {
      throw new Error("Veydrift settlement contract address is required.");
    }

    return this.callContract(this.settlementContractAddress, selector, args);
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
}

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const buildingCount = 16;
const defenseCount = 10;
const shipCount = 16;
const technologyCount = 16;
const riftBuildingId = 15;
const riftWithdrawalDelaySeconds = 30 * 24 * 60 * 60;
const riftResourceCatalog: Array<Pick<RiftResourceState, "key" | "label" | "resourceId">> = [
  { key: "metal", label: "Metal", resourceId: 0 },
  { key: "crystal", label: "Crystal", resourceId: 1 },
  { key: "deuterium", label: "Deuterium", resourceId: 2 }
];
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const colonyCreatedTopic = "0xd7d717f6607ff051c7f2247d5c490eb9ece607b9ee7c7eee946898025815cfc0";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";

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

function riftRequirements(
  riftLevel: number | null,
  roboticsLevel: number,
  researchLabLevel: number,
  technologyLevels: Record<string, number>
): RiftRequirement[] {
  return [
    {
      kind: "building",
      key: "interdimensionalRiftStabilizer",
      label: "Interdimensional Rift Stabilizer",
      currentLevel: riftLevel,
      requiredLevel: 1
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
    }
  ];
}

function decodeSettledPlanetLog(log: RpcLog): SettledPlanetEvent {
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
