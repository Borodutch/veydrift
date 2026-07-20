import { SettlementIndexer } from "./indexer";
import type { ChainReader } from "./evm";

type MaterializationReason = "ingest" | "backfill" | "repair";

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

try {
  const databasePath = requiredArg("--db");
  const fromBlock = BigInt(requiredArg("--from-block"));
  const reason = materializationReason(requiredArg("--reason"));
  const missionIds = requiredArg("--missions")
    .split(",")
    .map((missionId) => missionId.trim())
    .filter((missionId) => missionId.length > 0);

  const indexer = new SettlementIndexer(noopChainReader, fromBlock, {
    databasePath,
    // The long-lived backend writer owns schema migration. Re-acquiring schema locks in every
    // short-lived report worker can block otherwise read-only mission routes.
    assumeSchemaReady: true,
    runStartupBackfill: false
  });
  const materialized = indexer.materializeBattleReportReadModelsForWorker(missionIds, reason);
  console.info(`[battle-report-materializer-worker] ${reason} processed=${missionIds.length} materialized=${materialized}`);
} catch (error) {
  console.error(`[battle-report-materializer-worker] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function requiredArg(name: string): string {
  const index = Bun.argv.indexOf(name);
  const value = index >= 0 ? Bun.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function materializationReason(value: string): MaterializationReason {
  if (value === "ingest" || value === "backfill" || value === "repair") return value;
  throw new Error(`Unsupported materialization reason: ${value}`);
}
