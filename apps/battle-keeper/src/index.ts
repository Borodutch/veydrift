import { loadKeeperConfig, safeConfigSummary } from "./config";
import { BattleKeeper, consoleLogger } from "./keeper";
import { ViemMissionResolver } from "./resolver";
import { createHandler } from "./server";
import { LogBackfillSweep } from "./sweep";
import { HttpJsonRpcTransport } from "./transport";
import { WsBattleListener } from "./wsListener";

function main(): void {
  const { config, problems } = loadKeeperConfig();
  if (!config) {
    consoleLogger.error("[battle-keeper] invalid configuration:");
    for (const problem of problems) {
      consoleLogger.error(`  - ${problem.field}: ${problem.message}`);
    }
    process.exit(1);
    return;
  }

  consoleLogger.info("[battle-keeper] starting", safeConfigSummary(config));

  const transport = new HttpJsonRpcTransport(config.rpcUrl);
  const resolver = new ViemMissionResolver(
    transport,
    config.keeperPrivateKey,
    config.gameContractAddress,
    config.chainId
  );
  const keeper = new BattleKeeper(resolver, {
    maxConcurrency: config.maxConcurrency,
    logger: consoleLogger
  });
  const listener = new WsBattleListener(config.wsRpcUrl, config.gameContractAddress, keeper, {
    logger: consoleLogger
  });
  const sweep = new LogBackfillSweep(transport, config.gameContractAddress, keeper, {
    logger: consoleLogger
  });

  consoleLogger.info("[battle-keeper] keeper EOA", { address: keeper.snapshot().keeperAddress });

  listener.start();

  // Resolution loop: submit due missions promptly.
  const resolveTimer = setInterval(() => {
    void keeper.tick();
  }, config.resolveIntervalMs);

  // Safety sweep: backfill any missed launches + re-attempt due missions.
  const sweepTimer = setInterval(() => {
    void sweep.sweep().then(() => keeper.tick());
  }, config.sweepIntervalMs);

  // Deep one-time backfill at startup: scan a wide window (config.backfillBlocks, chunked) so the
  // keeper picks up every still-due mission launched before it started — overdue arrivals (which
  // block returns) and overdue returns alike — then converge them via tick().
  consoleLogger.info("[battle-keeper] startup deep backfill", { blocks: config.backfillBlocks });
  void sweep.sweep(BigInt(config.backfillBlocks)).then(() => keeper.tick());

  const startedAtMs = Date.now();
  const handler = createHandler(keeper, listener, startedAtMs);
  const server = Bun.serve({ port: config.port, fetch: handler });
  consoleLogger.info("[battle-keeper] health server listening", { port: server.port });

  const shutdown = (signal: string): void => {
    consoleLogger.info(`[battle-keeper] received ${signal}, shutting down`);
    clearInterval(resolveTimer);
    clearInterval(sweepTimer);
    listener.stop();
    void server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
