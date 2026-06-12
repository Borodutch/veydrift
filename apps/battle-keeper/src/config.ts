/**
 * Environment-driven configuration for the battle keeper. The keeper is a standalone service, so it
 * reads everything from `process.env` (documented in README.md) and never embeds secrets.
 */

export type KeeperConfig = {
  rpcUrl: string;
  wsRpcUrl: string;
  gameContractAddress: `0x${string}`;
  keeperPrivateKey: `0x${string}`;
  chainId: number;
  /** Backstop sweep cadence in case a WebSocket event is dropped. */
  sweepIntervalMs: number;
  /** How often the resolution loop scans the pending set for due missions. */
  resolveIntervalMs: number;
  /** HTTP health/status server port. */
  port: number;
  /** Max concurrent resolveFleetMission submissions in flight. */
  maxConcurrency: number;
};

export type ConfigProblem = {
  field: string;
  message: string;
};

export type LoadConfigResult = {
  config: KeeperConfig | null;
  problems: ConfigProblem[];
};

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/;

/** Base Sepolia. Overridable so the keeper can target any EVM chain that exposes the game contract. */
const defaultChainId = 84532;
const defaultSweepIntervalMs = 15_000;
const defaultResolveIntervalMs = 5_000;
const defaultPort = 8080;
const defaultMaxConcurrency = 3;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  field: string,
  problems: ConfigProblem[]
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    problems.push({ field, message: `${field} must be a positive integer; got "${raw}".` });
    return fallback;
  }
  return value;
}

export function loadKeeperConfig(env: NodeJS.ProcessEnv = process.env): LoadConfigResult {
  const problems: ConfigProblem[] = [];

  const rpcUrl = env.RPC_URL?.trim() ?? "";
  if (!rpcUrl) {
    problems.push({ field: "RPC_URL", message: "RPC_URL (http JSON-RPC endpoint) is required." });
  }

  const wsRpcUrl = env.WS_RPC_URL?.trim() ?? "";
  if (!wsRpcUrl) {
    problems.push({ field: "WS_RPC_URL", message: "WS_RPC_URL (ws JSON-RPC endpoint) is required." });
  }

  const gameContractAddress = env.GAME_CONTRACT_ADDRESS?.trim() ?? "";
  if (!addressPattern.test(gameContractAddress)) {
    problems.push({
      field: "GAME_CONTRACT_ADDRESS",
      message: "GAME_CONTRACT_ADDRESS must be a 0x-prefixed 20-byte address."
    });
  }

  const keeperPrivateKey = env.KEEPER_PRIVATE_KEY?.trim() ?? "";
  if (!privateKeyPattern.test(keeperPrivateKey)) {
    problems.push({
      field: "KEEPER_PRIVATE_KEY",
      message: "KEEPER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key."
    });
  }

  const chainId = parsePositiveInt(env.CHAIN_ID, defaultChainId, "CHAIN_ID", problems);
  const sweepIntervalMs = parsePositiveInt(
    env.SWEEP_INTERVAL_MS,
    defaultSweepIntervalMs,
    "SWEEP_INTERVAL_MS",
    problems
  );
  const resolveIntervalMs = parsePositiveInt(
    env.RESOLVE_INTERVAL_MS,
    defaultResolveIntervalMs,
    "RESOLVE_INTERVAL_MS",
    problems
  );
  const port = parsePositiveInt(env.PORT, defaultPort, "PORT", problems);
  const maxConcurrency = parsePositiveInt(
    env.MAX_CONCURRENCY,
    defaultMaxConcurrency,
    "MAX_CONCURRENCY",
    problems
  );

  if (problems.length > 0) {
    return { config: null, problems };
  }

  return {
    config: {
      rpcUrl,
      wsRpcUrl,
      gameContractAddress: gameContractAddress as `0x${string}`,
      keeperPrivateKey: keeperPrivateKey as `0x${string}`,
      chainId,
      sweepIntervalMs,
      resolveIntervalMs,
      port,
      maxConcurrency
    },
    problems: []
  };
}

/** Redacts the private key so the resolved config is safe to log on startup. */
export function safeConfigSummary(config: KeeperConfig): Record<string, unknown> {
  return {
    rpcUrl: config.rpcUrl,
    wsRpcUrl: config.wsRpcUrl,
    gameContractAddress: config.gameContractAddress,
    keeperPrivateKey: "[redacted]",
    chainId: config.chainId,
    sweepIntervalMs: config.sweepIntervalMs,
    resolveIntervalMs: config.resolveIntervalMs,
    port: config.port,
    maxConcurrency: config.maxConcurrency
  };
}
