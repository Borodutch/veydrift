import { loadBackendConfig, safeConfigSummary } from "./config";
import type { ChainReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { emitObservabilityEvent } from "./observability";

const materializerWorkerPath = new URL("./battleReportMaterializerWorker.ts", import.meta.url).pathname;

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
  concurrency: number;
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
    private readonly options: { databasePath: string; fromBlock: bigint; intervalMs: number; batchSize: number; concurrency: number }
  ) {}

  snapshot(): MissionReportGeneratorSnapshot {
    return {
      enabled: true,
      intervalMs: this.options.intervalMs,
      batchSize: this.options.batchSize,
      concurrency: this.options.concurrency,
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
        const materialized = await this.materializeInParallel(missionIds);
        this.processedCount += missionIds.length;
        this.materializedCount += materialized;
        emitObservabilityEvent({
          kind: "mission_report_generator_tick",
          component: "mission-report-generator",
          processed: missionIds.length,
          materialized
        });
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[mission-report-generator] tick failed", error);
    } finally {
      this.inFlight = false;
    }
  }

  private async materializeInParallel(missionIds: string[]): Promise<number> {
    const chunkSize = Math.max(1, Math.ceil(missionIds.length / this.options.concurrency));
    const batches = chunks(missionIds, chunkSize);
    const results = await Promise.all(batches.map((batch) => this.runMaterializerWorker(batch)));
    return results.reduce((total, result) => total + result.materialized, 0);
  }

  private async runMaterializerWorker(missionIds: string[]): Promise<{ materialized: number }> {
    const process = Bun.spawn({
      cmd: [
        Bun.argv[0] ?? "bun",
        materializerWorkerPath,
        "--db",
        this.options.databasePath,
        "--from-block",
        this.options.fromBlock.toString(),
        "--reason",
        "ingest",
        "--missions",
        missionIds.join(",")
      ],
      stdout: "pipe",
      stderr: "pipe"
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited
    ]);
    if (stdout.trim()) console.info(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    if (exitCode !== 0) {
      throw new Error(`battle report materializer worker exited with ${exitCode}`);
    }
    return { materialized: parsedMaterializedCount(stdout) };
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
    databasePath: loaded.config.indexDbPath,
    fromBlock: loaded.config.indexFromBlock,
    intervalMs: positiveInt(process.env.VEYDRIFT_MISSION_REPORT_GENERATOR_INTERVAL_MS, 3_000),
    batchSize: positiveInt(process.env.VEYDRIFT_MISSION_REPORT_GENERATOR_BATCH_SIZE, 50),
    concurrency: positiveInt(process.env.VEYDRIFT_MISSION_REPORT_GENERATOR_CONCURRENCY, 4)
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

emitObservabilityEvent({
  kind: "service_start",
  component: "mission-report-generator",
  message: `[mission-report-generator] listening on http://localhost:${port}`,
  port
});

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function parsedMaterializedCount(output: string): number {
  const match = output.match(/\bmaterialized=(\d+)\b/);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}
