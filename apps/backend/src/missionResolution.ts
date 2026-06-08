import type { BackendConfig } from "./config";
import { HttpJsonRpcTransport, type Address, type ResolvableFleetMission, type ReturnableFleetMission } from "./evm";

export type MissionResolutionReader = {
  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]>;
  listReturnableFleetMissions?(): Promise<ReturnableFleetMission[]>;
};

type MissionResolutionTransport = Pick<HttpJsonRpcTransport, "request">;

export type MissionResolutionSnapshot = {
  enabled: boolean;
  resolverConfigured: boolean;
  submittedCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  lastSubmittedMissionId: string | null;
};

const resolveFleetMissionSelector = "0xde09e7cf";
const completeFleetMissionReturnSelector = "0xc2472852";
const defaultIntervalMs = 30_000;

export class MissionResolutionService {
  private readonly enabled: boolean;
  private readonly resolvedMissionIds = new Set<string>();
  private readonly completedReturnMissionIds = new Set<string>();
  private inFlight = false;
  private lastError: string | null = null;
  private lastRunAt: string | null = null;
  private lastSubmittedMissionId: string | null = null;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly transport: MissionResolutionTransport | undefined;

  constructor(
    private readonly config: BackendConfig,
    private readonly reader: MissionResolutionReader | undefined,
    options: {
      intervalMs?: number;
      transport?: MissionResolutionTransport;
    } = {}
  ) {
    this.enabled = Boolean(
      config.missionResolutionEnabled
        && config.gameContractAddress
        && config.missionResolverAddress
        && reader
    );
    this.transport = options.transport ?? (config.rpcUrl ? new HttpJsonRpcTransport(config.rpcUrl) : undefined);
    this.intervalMs = options.intervalMs ?? defaultIntervalMs;
  }

  start(): void {
    if (!this.enabled || this.timer) {
      return;
    }

    void this.resolveDueMissions();
    this.timer = setInterval(() => {
      void this.resolveDueMissions();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  snapshot(): MissionResolutionSnapshot {
    return {
      enabled: this.enabled,
      resolverConfigured: Boolean(this.config.missionResolverAddress),
      submittedCount: this.resolvedMissionIds.size + this.completedReturnMissionIds.size,
      lastError: this.lastError,
      lastRunAt: this.lastRunAt,
      lastSubmittedMissionId: this.lastSubmittedMissionId
    };
  }

  async resolveDueMissions(): Promise<void> {
    if (
      !this.enabled
        || this.inFlight
        || !this.reader
        || !this.transport
        || !this.config.gameContractAddress
        || !this.config.missionResolverAddress
    ) {
      return;
    }

    this.inFlight = true;
    this.lastRunAt = new Date().toISOString();
    try {
      const resolver = this.config.missionResolverAddress;
      const contractAddress = this.config.gameContractAddress;

      // Arrival leg: resolve Outbound missions whose arrival has passed. This delivers Transport
      // cargo / credits Deploy ships to the target and runs combat for Attack/Harvest/Colonize.
      const resolvable = await this.reader.listResolvableFleetMissions();
      for (const mission of resolvable) {
        if (this.resolvedMissionIds.has(mission.missionId)) {
          continue;
        }

        await this.submitCall(resolver, contractAddress, encodeResolveFleetMissionCall(BigInt(mission.missionId)));
        this.resolvedMissionIds.add(mission.missionId);
        this.lastSubmittedMissionId = mission.missionId;
      }

      // Return leg: complete Returning missions whose return has passed so surviving ships and
      // carried loot/cargo are credited back to the origin planet without manual action.
      const returnable = this.reader.listReturnableFleetMissions
        ? await this.reader.listReturnableFleetMissions()
        : [];
      for (const mission of returnable) {
        if (this.completedReturnMissionIds.has(mission.missionId)) {
          continue;
        }

        await this.submitCall(resolver, contractAddress, encodeCompleteFleetMissionReturnCall(BigInt(mission.missionId)));
        this.completedReturnMissionIds.add(mission.missionId);
        this.lastSubmittedMissionId = mission.missionId;
      }

      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.inFlight = false;
    }
  }

  private async submitCall(resolver: Address, contractAddress: Address, data: string): Promise<void> {
    await this.transport?.request<string>("eth_sendTransaction", [
      {
        from: resolver,
        to: contractAddress,
        data
      }
    ]);
  }
}

export function encodeResolveFleetMissionCall(missionId: bigint): string {
  return `${resolveFleetMissionSelector}${missionId.toString(16).padStart(64, "0")}`;
}

export function encodeCompleteFleetMissionReturnCall(missionId: bigint): string {
  return `${completeFleetMissionReturnSelector}${missionId.toString(16).padStart(64, "0")}`;
}
