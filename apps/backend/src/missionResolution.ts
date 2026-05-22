import type { BackendConfig } from "./config";
import { HttpJsonRpcTransport, type Address, type ResolvableFleetMission } from "./evm";

export type MissionResolutionReader = {
  listResolvableFleetMissions(): Promise<ResolvableFleetMission[]>;
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
const defaultIntervalMs = 30_000;

export class MissionResolutionService {
  private readonly enabled: boolean;
  private readonly submittedMissionIds = new Set<string>();
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
      submittedCount: this.submittedMissionIds.size,
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
      const missions = await this.reader.listResolvableFleetMissions();
      for (const mission of missions) {
        if (this.submittedMissionIds.has(mission.missionId)) {
          continue;
        }

        await this.submitResolution(this.config.missionResolverAddress, this.config.gameContractAddress, mission);
        this.submittedMissionIds.add(mission.missionId);
        this.lastSubmittedMissionId = mission.missionId;
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.inFlight = false;
    }
  }

  private async submitResolution(resolver: Address, contractAddress: Address, mission: ResolvableFleetMission): Promise<void> {
    await this.transport?.request<string>("eth_sendTransaction", [
      {
        from: resolver,
        to: contractAddress,
        data: encodeResolveFleetMissionCall(BigInt(mission.missionId))
      }
    ]);
  }
}

export function encodeResolveFleetMissionCall(missionId: bigint): string {
  return `${resolveFleetMissionSelector}${missionId.toString(16).padStart(64, "0")}`;
}
