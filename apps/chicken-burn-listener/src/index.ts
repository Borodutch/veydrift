import { burnEventAbiItem } from "./events";
import { loadConfig, safeConfigSummary } from "./config";
import { ViemMoonGrantClient } from "./grant";
import { ChickenBurnProcessor, consoleLogger } from "./processor";
import { HttpJsonRpcTransport } from "./rpc";
import { createHandler } from "./server";
import { ChickenBurnSource } from "./source";
import { JsonStateStore } from "./store";

async function main(): Promise<void> {
  const { config, problems } = loadConfig();
  if (!config) {
    consoleLogger.error("[chicken-burn] invalid configuration:");
    for (const problem of problems) {
      consoleLogger.error(`  - ${problem.field}: ${problem.message}`);
    }
    process.exit(1);
    return;
  }

  consoleLogger.info("[chicken-burn] starting", safeConfigSummary(config));

  const burnEvent = burnEventAbiItem(config.chickenBurnEventSignature);
  const store = new JsonStateStore(config.stateFile);
  await store.load();
  const grantClient = new ViemMoonGrantClient(
    config.veydriftRpcUrl,
    config.veydriftMoonSystemAddress,
    config.veydriftGrantPrivateKey,
    config.veydriftChainId
  );
  const processor = new ChickenBurnProcessor(store, grantClient, consoleLogger);
  const source = new ChickenBurnSource(
    new HttpJsonRpcTransport(config.baseMainnetHttpRpcUrl),
    config.baseMainnetWsRpcUrl,
    config.chickenContractAddress,
    burnEvent,
    store,
    processor,
    {
      startBlock: config.chickenBurnStartBlock,
      backfillBlocks: config.backfillBlocks,
      maxRangeBlocks: config.maxRangeBlocks,
      logger: consoleLogger
    }
  );

  consoleLogger.info("[chicken-burn] grant EOA", { address: grantClient.grantAddress() });
  source.start();
  void source.backfill(config.backfillBlocks).catch((error) => {
    consoleLogger.error("[chicken-burn] startup backfill failed", error);
  });
  const backfillTimer = setInterval(() => {
    void source.backfill().catch((error) => {
      consoleLogger.error("[chicken-burn] periodic backfill failed", error);
    });
  }, config.backfillIntervalMs);

  const server = Bun.serve({
    port: config.port,
    fetch: createHandler(source, processor, store, Date.now())
  });
  consoleLogger.info("[chicken-burn] health server listening", { port: server.port });

  const shutdown = (signal: string): void => {
    consoleLogger.info(`[chicken-burn] received ${signal}, shutting down`);
    clearInterval(backfillTimer);
    source.stop();
    void server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
