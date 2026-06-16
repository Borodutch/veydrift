import { loadBackendConfig } from "./config";
import { VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";

type ReplayArgs = {
  canonicalSync: boolean;
  canonicalSyncRebuildDeadlineMs?: number;
  currentStateSeed: boolean;
  currentStateConcurrency?: number;
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
};

async function main(): Promise<void> {
  const loaded = loadBackendConfig();
  if (loaded.problems.length > 0) {
    throw new Error(`Backend config is not replayable: ${loaded.problems.map((problem) => problem.message).join("; ")}`);
  }

  const args = parseArgs(process.argv.slice(2));
  const reader = new VeydriftGameReader(loaded.config, undefined, { hydrateQueueStartedAt: false });
  const indexer = new SettlementIndexer(reader, loaded.config.indexFromBlock, {
    databasePath: loaded.config.indexDbPath,
    qaSyntheticStationedDefenders: loaded.config.qaSyntheticStationedDefenders,
    randomnessEngineConfigured: Boolean(loaded.config.randomnessEngineAddress),
    ...(loaded.config.rebuildDeadlineMs ? { rebuildDeadlineMs: loaded.config.rebuildDeadlineMs } : {})
  });

  const before = indexer.snapshot();
  const fromBlock = args.fromBlock ?? replayFromBlock(before.latestIndexedBlock, loaded.config.indexFromBlock);
  const toBlock = args.toBlock ?? "latest";
  const result = args.currentStateSeed
    ? { replay: null, rebuild: await indexer.seedCurrentCanonicalState({ planetConcurrency: args.currentStateConcurrency ?? 25 }) }
    : args.canonicalSync
    ? await indexer.syncCanonicalState(fromBlock, toBlock, {
      rebuildDeadlineMs: args.canonicalSyncRebuildDeadlineMs ?? 0
    })
    : { replay: await indexer.replayContractLogs(fromBlock, toBlock), rebuild: null };
  const after = result.rebuild ?? result.replay;

  console.log(JSON.stringify({
    replay: {
      fromBlock: fromBlock.toString(),
      toBlock: typeof toBlock === "bigint" ? toBlock.toString() : toBlock,
      materializedRebuildFromStoredLogs: !args.currentStateSeed,
      canonicalSync: args.canonicalSync,
      canonicalSyncRebuildDeadlineMs: args.canonicalSync ? args.canonicalSyncRebuildDeadlineMs ?? null : null,
      currentStateSeed: args.currentStateSeed,
      currentStateConcurrency: args.currentStateSeed ? args.currentStateConcurrency ?? 25 : null
    },
    before,
    ...(result.rebuild && result.replay ? { afterReplay: result.replay } : {}),
    after
  }, null, 2));
}

function replayFromBlock(latestIndexedBlock: string | null, configuredFromBlock: bigint): bigint {
  if (latestIndexedBlock) {
    try {
      return BigInt(latestIndexedBlock) + 1n;
    } catch {
      // Fall through to configured base.
    }
  }
  return configuredFromBlock;
}

function parseArgs(args: string[]): ReplayArgs {
  const parsed: ReplayArgs = { canonicalSync: false, currentStateSeed: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--canonical-sync") {
      parsed.canonicalSync = true;
    } else if (arg === "--current-state-seed") {
      parsed.currentStateSeed = true;
    } else if (arg === "--from-block") {
      if (!value) throw new Error("--from-block requires a value");
      parsed.fromBlock = BigInt(value);
      index += 1;
    } else if (arg === "--to-block") {
      if (!value) throw new Error("--to-block requires a value");
      parsed.toBlock = value === "latest" ? "latest" : BigInt(value);
      index += 1;
    } else if (arg === "--sync-deadline-ms") {
      if (!value) throw new Error("--sync-deadline-ms requires a value");
      const deadlineMs = Number(value);
      if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) {
        throw new Error("--sync-deadline-ms must be a non-negative integer");
      }
      parsed.canonicalSyncRebuildDeadlineMs = deadlineMs;
      index += 1;
    } else if (arg === "--current-state-concurrency") {
      if (!value) throw new Error("--current-state-concurrency requires a value");
      const concurrency = Number(value);
      if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new Error("--current-state-concurrency must be a positive integer");
      }
      parsed.currentStateConcurrency = concurrency;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (parsed.currentStateSeed && parsed.canonicalSync) {
    throw new Error("--current-state-seed and --canonical-sync are mutually exclusive");
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
