import { loadBackendConfig, safeConfigSummary } from "./config";
import type { ChainReader } from "./evm";
import { SettlementIndexer } from "./indexer";

const noopChainReader: Pick<ChainReader, "listDebrisFieldEvents" | "listMoonChanceReportEvents" | "listSettledPlanetEvents"> = {
  async listDebrisFieldEvents() {
    return [];
  },
  async listMoonChanceReportEvents() {
    return [];
  },
  async listSettledPlanetEvents() {
    return [];
  }
};

type MissionReportGeneratorSnapshot = {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastProcessedMissionIds: string[];
  processedCount: number;
  materializedCount: number;
};

class MissionReportGeneratorService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private lastProcessedMissionIds: string[] = [];
  private processedCount = 0;
  private materializedCount = 0;

  constructor(
    private readonly indexer: SettlementIndexer,
    private readonly options: { intervalMs: number; batchSize: number }
  ) {}

  snapshot(): MissionReportGeneratorSnapshot {
    return {
      enabled: true,
      intervalMs: this.options.intervalMs,
      batchSize: this.options.batchSize,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      lastProcessedMissionIds: this.lastProcessedMissionIds,
      processedCount: this.processedCount,
      materializedCount: this.materializedCount
    };
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    this.timer.unref?.();
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.lastRunAt = new Date().toISOString();
    try {
      const missionIds = this.indexer.pendingBattleReportMaterializationMissionIds(this.options.batchSize);
      this.lastProcessedMissionIds = missionIds;
      if (missionIds.length > 0) {
        const materialized = this.indexer.materializeBattleReportReadModelsForWorker(missionIds, "ingest");
        this.processedCount += missionIds.length;
        this.materializedCount += materialized;
        console.info(`[mission-report-generator] processed=${missionIds.length} materialized=${materialized}`);
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[mission-report-generator] tick failed", error);
    } finally {
      this.inFlight = false;
    }
  }
}

const loaded = loadBackendConfig();
if (!loaded.config.indexDbPath) {
  console.error("[mission-report-generator] disabled: VEYDRIFT_INDEX_DB_PATH is required");
  process.exit(1);
}

const service = new MissionReportGeneratorService(
  new SettlementIndexer(noopChainReader, loaded.config.indexFromBlock, {
    databasePath: loaded.config.indexDbPath,
    runStartupBackfill: false
  }),
  {
    intervalMs: positiveInt(process.env.VEYDRIFT_MISSION_REPORT_GENERATOR_INTERVAL_MS, 3_000),
    batchSize: positiveInt(process.env.VEYDRIFT_MISSION_REPORT_GENERATOR_BATCH_SIZE, 25)
  }
);
service.start();

const port = Number.parseInt(process.env.PORT ?? "4101", 10);
Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      const snapshot = service.snapshot();
      return Response.json({
        ok: snapshot.lastError === null,
        service: "veydrift-mission-report-generator",
        chain: safeConfigSummary(loaded.config),
        missionReportGenerator: snapshot
      });
    }
    return new Response("not found", { status: 404 });
  }
});

console.log(`[mission-report-generator] listening on http://localhost:${port}`);

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
