import { loadBackendConfig, safeConfigSummary, type ConfigProblem } from "./config";
import { RandomnessCommitterService } from "./randomnessCommitter";

const port = Number.parseInt(process.env.PORT ?? "4100", 10);
const loaded = loadBackendConfig();
const requiredProblems = randomnessOracleProblems(loaded.problems);

if (requiredProblems.length > 0) {
  console.error(
    "[randomness-oracle] missing required config",
    requiredProblems.map((problem) => `${problem.field}: ${problem.message}`).join("; ")
  );
  process.exit(1);
}

const service = new RandomnessCommitterService(loaded.config, {
  intervalMs: Number.parseInt(process.env.VEYDRIFT_RANDOMNESS_POLL_INTERVAL_MS ?? "1000", 10)
});

if (!service.snapshot().enabled) {
  console.error("[randomness-oracle] disabled: RPC, randomness engine, or fulfiller key is missing");
  process.exit(1);
}

service.start();

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      const snapshot = service.snapshot();
      return Response.json({
        ok: snapshot.lastError === null,
        service: "veydrift-randomness-oracle",
        chain: safeConfigSummary(loaded.config),
        randomnessCommitter: snapshot
      });
    }
    return new Response("not found", { status: 404 });
  }
});

console.log(`[randomness-oracle] listening on http://localhost:${port}`);

function randomnessOracleProblems(problems: ConfigProblem[]): ConfigProblem[] {
  const ignoredFields = new Set([
    "VEYDRIFT_GAME_CONTRACT_ADDRESS"
  ]);
  const relevantProblems = problems.filter((problem) => !ignoredFields.has(problem.field));
  if (!loaded.config.randomnessEngineAddress) {
    relevantProblems.push({
      field: "VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS",
      message: "Set the deployed RandomnessEngine address."
    });
  }
  if (!loaded.config.randomnessFulfillerPrivateKey) {
    relevantProblems.push({
      field: "VEYDRIFT_RANDOMNESS_FULFILLER_KEY",
      message: "Set VEYDRIFT_RANDOMNESS_FULFILLER_KEY or VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY."
    });
  }
  return relevantProblems;
}
