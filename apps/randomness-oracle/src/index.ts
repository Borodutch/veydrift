import { loadConfig } from "./config";
import { EngineClient } from "./engine";
import { Oracle } from "./oracle";

function log(message: string, extra?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), msg: message, ...extra };
  console.log(JSON.stringify(line));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = new EngineClient(config);
  const oracle = new Oracle(engine, {
    startRequestId: config.startRequestId,
    maxFulfillmentsPerTick: config.maxFulfillmentsPerTick
  });

  log("randomness-oracle starting", {
    engine: config.randomnessEngineAddress,
    chainId: config.chainId,
    fulfiller: engine.account.address,
    pollIntervalMs: config.pollIntervalMs
  });

  // Startup sanity: confirm our key is actually the engine's fulfiller and has gas.
  try {
    const [onchainFulfiller, precommit, balance] = await Promise.all([
      engine.fulfiller(),
      engine.precommitRequired(),
      engine.fulfillerBalance()
    ]);
    if (onchainFulfiller.toLowerCase() !== engine.account.address.toLowerCase()) {
      log("WARNING: configured key is not the on-chain fulfiller", {
        onchainFulfiller,
        configuredFulfiller: engine.account.address
      });
    }
    log("startup diagnostics", {
      onchainFulfiller,
      precommitRequired: precommit,
      fulfillerBalanceWei: balance.toString()
    });
  } catch (error) {
    log("startup diagnostics failed (will keep retrying in loop)", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  let lastStatus = oracle.status();
  let running = true;

  const server = Bun.serve({
    port: config.port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health" || url.pathname === "/") {
        const healthy = lastStatus.lastError === null || lastStatus.fulfilledTotal > 0;
        return new Response(JSON.stringify({ ok: healthy, ...lastStatus }, null, 2), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("not found", { status: 404 });
    }
  });
  log("health server listening", { port: server.port });

  const shutdown = () => {
    running = false;
    log("shutting down");
    server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (running) {
    try {
      lastStatus = await oracle.tick();
      if (lastStatus.pending > 0 || lastStatus.lastError) {
        log("tick", lastStatus as unknown as Record<string, unknown>);
      }
    } catch (error) {
      log("tick failed", { error: error instanceof Error ? error.message : String(error) });
    }
    await Bun.sleep(config.pollIntervalMs);
  }
}

main().catch((error) => {
  log("fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
