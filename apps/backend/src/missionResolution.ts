import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { BackendConfig } from "./config";
import type { Address, ResolvableFleetMission, ReturnableFleetMission } from "./evm";
import { VeydriftGameReader } from "./evm";

const missionResolutionIntervalMs = 30_000;
const maxMissionsPerTick = 12;

const veydriftGameResolutionAbi = [
  {
    type: "function",
    name: "resolveFleetMission",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "missionId" }],
    outputs: []
  },
  {
    type: "function",
    name: "completeFleetMissionReturn",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "missionId" }],
    outputs: []
  }
] as const;

export type MissionResolutionChainClient = {
  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]>;
  listReturnableFleetMissions(): Promise<ReturnableFleetMission[]>;
  resolveFleetMission(missionId: string): Promise<string>;
  completeFleetMissionReturn(missionId: string): Promise<string>;
};

export type MissionResolutionSnapshot = {
  enabled: boolean;
  resolverConfigured: boolean;
  resolverAddress: Address | null;
  intervalMs: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastResolvedMissionId: string | null;
  lastReturnedMissionId: string | null;
  resolvedCount: number;
  returnedCount: number;
};

export type MissionResolutionLogger = {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export type MissionResolutionServiceOptions = {
  chainClient?: MissionResolutionChainClient;
  intervalMs?: number;
  logger?: MissionResolutionLogger;
  maxMissionsPerTick?: number;
};

export class MissionResolutionService {
  private readonly chainClient: MissionResolutionChainClient | undefined;
  private readonly intervalMs: number;
  private readonly logger: MissionResolutionLogger;
  private readonly maxMissionsPerTick: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private lastResolvedMissionId: string | null = null;
  private lastReturnedMissionId: string | null = null;
  private resolvedCount = 0;
  private returnedCount = 0;

  constructor(
    private readonly config: BackendConfig,
    options: MissionResolutionServiceOptions = {}
  ) {
    this.chainClient = options.chainClient ?? buildMissionResolutionChainClient(config);
    this.intervalMs = options.intervalMs ?? missionResolutionIntervalMs;
    this.logger = options.logger ?? console;
    this.maxMissionsPerTick = Math.max(1, Math.floor(options.maxMissionsPerTick ?? maxMissionsPerTick));
  }

  snapshot(): MissionResolutionSnapshot {
    return {
      enabled: this.enabled,
      resolverConfigured: Boolean(this.config.missionResolverAddress || this.config.missionResolverPrivateKey),
      resolverAddress: this.resolverAddress(),
      intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      lastResolvedMissionId: this.lastResolvedMissionId,
      lastReturnedMissionId: this.lastReturnedMissionId,
      resolvedCount: this.resolvedCount,
      returnedCount: this.returnedCount
    };
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (!this.enabled || this.inFlight || !this.chainClient) return;
    this.inFlight = true;
    this.lastRunAt = new Date().toISOString();
    try {
      await this.resolveDueMissions();
      await this.returnDueMissions();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("[mission-resolution] tick failed", error);
    } finally {
      this.inFlight = false;
    }
  }

  private get enabled(): boolean {
    return this.config.missionResolutionEnabled && Boolean(this.chainClient);
  }

  private resolverAddress(): Address | null {
    if (this.config.missionResolverPrivateKey) {
      return privateKeyToAccount(this.config.missionResolverPrivateKey).address.toLowerCase() as Address;
    }
    return this.config.missionResolverAddress?.toLowerCase() as Address | undefined ?? null;
  }

  private async resolveDueMissions(): Promise<void> {
    if (!this.chainClient) return;
    const missions = await this.chainClient.listResolvableFleetMissions();
    for (const mission of missions.slice(0, this.maxMissionsPerTick)) {
      try {
        await this.chainClient.resolveFleetMission(mission.missionId);
        this.lastResolvedMissionId = mission.missionId;
        this.resolvedCount += 1;
      } catch (error) {
        this.logger.warn(`[mission-resolution] resolveFleetMission(${mission.missionId}) failed: ${reasonText(error)}`);
      }
    }
  }

  private async returnDueMissions(): Promise<void> {
    if (!this.chainClient) return;
    const missions = await this.chainClient.listReturnableFleetMissions();
    for (const mission of missions.slice(0, this.maxMissionsPerTick)) {
      try {
        await this.chainClient.completeFleetMissionReturn(mission.missionId);
        this.lastReturnedMissionId = mission.missionId;
        this.returnedCount += 1;
      } catch (error) {
        this.logger.warn(`[mission-resolution] completeFleetMissionReturn(${mission.missionId}) failed: ${reasonText(error)}`);
      }
    }
  }
}

export class ViemMissionResolutionChainClient implements MissionResolutionChainClient {
  constructor(
    private readonly reader: Pick<VeydriftGameReader, "listResolvableFleetMissions" | "listReturnableFleetMissions">,
    private readonly gameAddress: Address,
    private readonly sender: Address | ReturnType<typeof privateKeyToAccount>,
    private readonly publicClient?: PublicClient,
    private readonly walletClient?: WalletClient,
    private readonly chain?: ReturnType<typeof defineChain>,
    private readonly rpcUrl?: string
  ) {}

  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]> {
    return this.reader.listResolvableFleetMissions();
  }

  listReturnableFleetMissions(): Promise<ReturnableFleetMission[]> {
    return this.reader.listReturnableFleetMissions();
  }

  resolveFleetMission(missionId: string): Promise<string> {
    return this.write("resolveFleetMission", missionId);
  }

  completeFleetMissionReturn(missionId: string): Promise<string> {
    return this.write("completeFleetMissionReturn", missionId);
  }

  private async write(functionName: "resolveFleetMission" | "completeFleetMissionReturn", missionId: string): Promise<string> {
    const data = encodeFunctionData({
      abi: veydriftGameResolutionAbi,
      functionName,
      args: [BigInt(missionId)]
    });
    if (typeof this.sender !== "string") {
      if (!this.walletClient || !this.publicClient || !this.chain) {
        throw new Error("private-key mission resolver is missing viem clients");
      }
      const hash = await this.walletClient.writeContract({
        abi: veydriftGameResolutionAbi,
        account: this.sender,
        address: this.gameAddress,
        chain: this.chain,
        functionName,
        args: [BigInt(missionId)]
      });
      await this.confirm(hash);
      return hash;
    }
    if (!this.rpcUrl) {
      throw new Error("unlocked-account mission resolver is missing RPC URL");
    }
    return this.sendUnlockedTransaction(this.sender, data);
  }

  private async confirm(hash: Hex): Promise<void> {
    if (!this.publicClient) return;
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`transaction ${hash} reverted`);
    }
  }

  private async sendUnlockedTransaction(from: Address, data: Hex): Promise<string> {
    const response = await fetch(this.rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendTransaction",
        params: [{ from, to: this.gameAddress, data }]
      })
    });
    const body = await response.json() as { error?: { message?: string }; result?: string };
    if (!response.ok || body.error || !body.result) {
      throw new Error(body.error?.message ?? `RPC HTTP ${response.status}`);
    }
    return body.result;
  }
}

function buildMissionResolutionChainClient(config: BackendConfig): MissionResolutionChainClient | undefined {
  if (!config.gameContractAddress || !config.rpcUrl || !config.missionResolutionEnabled) return undefined;
  if (!config.missionResolverAddress && !config.missionResolverPrivateKey) return undefined;

  const reader = new VeydriftGameReader(config, undefined, { hydrateQueueStartedAt: false });
  if (config.missionResolverPrivateKey) {
    const chain = defineChain({
      id: config.chainId,
      name: `veydrift-${config.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } }
    });
    const account = privateKeyToAccount(config.missionResolverPrivateKey);
    const transport = http(config.rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });
    return new ViemMissionResolutionChainClient(
      reader,
      config.gameContractAddress,
      account,
      publicClient,
      walletClient,
      chain,
      config.rpcUrl
    );
  }

  return new ViemMissionResolutionChainClient(
    reader,
    config.gameContractAddress,
    config.missionResolverAddress!,
    undefined,
    undefined,
    undefined,
    config.rpcUrl
  );
}

function reasonText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
