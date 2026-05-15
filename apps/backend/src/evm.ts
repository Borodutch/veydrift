import type { BackendConfig } from "./config";
import type { Coordinates } from "./universe";
import { planetMetadata, planetMultipliers } from "./universe";

export type Address = `0x${string}`;

export type Resources = {
  metal: string;
  crystal: string;
  deuterium: string;
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

export type SettledPlanetEvent = PlanetState & {
  eventName: "PlanetStarted" | "ColonyCreated";
  transactionHash: string;
  blockNumber: string;
};

export interface ChainReader {
  getWalletSettlement(wallet: Address): Promise<WalletSettlement>;
  getPlanet(planetId: bigint): Promise<PlanetState | null>;
  getPlayerQueues(wallet: Address): Promise<PlayerQueues>;
  getShipyardState(wallet: Address): Promise<ShipyardState>;
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
    this.settlementContractAddress = config.settlementContractAddress;
  }

  async getWalletSettlement(wallet: Address): Promise<WalletSettlement> {
    assertAddress(wallet);
    try {
      const gameSettlement = await this.getGameSettlement(wallet);
      if (gameSettlement.homePlanetId || !this.settlementContractAddress) {
        return gameSettlement;
      }

      return this.getCompactSettlement(wallet);
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
    return {
      active,
      kind: active ? kind : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      ...(kind === "building"
        ? { targetLevel: Number(decodeUintWord(wordAt(words, 2))) }
        : { quantity: Number(decodeUintWord(wordAt(words, 2))) }),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };
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
const shipCount = 16;
const technologyCount = 16;
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const colonyCreatedTopic = "0xd7d717f6607ff051c7f2247d5c490eb9ece607b9ee7c7eee946898025815cfc0";

export function assertAddress(address: string): asserts address is Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid EVM address.");
  }
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
