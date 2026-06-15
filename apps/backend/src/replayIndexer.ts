import { loadBackendConfig } from "./config";
import { VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";

type ReplayArgs = {
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
  const after = await indexer.replayContractLogs(fromBlock, toBlock);

  console.log(JSON.stringify({
    replay: {
      fromBlock: fromBlock.toString(),
      toBlock: typeof toBlock === "bigint" ? toBlock.toString() : toBlock,
      materializedRebuildFromStoredLogs: true
    },
    before,
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
  const parsed: ReplayArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--from-block") {
      if (!value) throw new Error("--from-block requires a value");
      parsed.fromBlock = BigInt(value);
      index += 1;
    } else if (arg === "--to-block") {
      if (!value) throw new Error("--to-block requires a value");
      parsed.toBlock = value === "latest" ? "latest" : BigInt(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
