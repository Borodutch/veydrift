export type ChickenBurnListenerConfig = {
  baseMainnetHttpRpcUrl: string;
  baseMainnetWsRpcUrl: string;
  chickenContractAddress: `0x${string}`;
  chickenBurnEventSignature: string;
  chickenBurnStartBlock: bigint;
  veydriftRpcUrl: string;
  veydriftMoonSystemAddress: `0x${string}`;
  veydriftGrantPrivateKey: `0x${string}`;
  veydriftChainId: number;
  stateFile: string;
  backfillIntervalMs: number;
  backfillBlocks: bigint;
  maxRangeBlocks: bigint;
  port: number;
};

export type ConfigProblem = {
  field: string;
  message: string;
};

export type LoadConfigResult = {
  config: ChickenBurnListenerConfig | null;
  problems: ConfigProblem[];
};

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/;

export const defaultChickenBurnEventSignature =
  "event ChickenBurned(address indexed burner,uint256 indexed tokenId,uint256 planetId,uint16 galaxy,uint16 system,uint8 position)";

const defaultVeydriftChainId = 84532;
const defaultBackfillIntervalMs = 15_000;
const defaultBackfillBlocks = 2_000n;
const defaultMaxRangeBlocks = 90_000n;
const defaultPort = 8080;
const defaultStateFile = "./chicken-burn-listener-state.json";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadConfigResult {
  const problems: ConfigProblem[] = [];

  const baseMainnetHttpRpcUrl = requireText(
    env.BASE_MAINNET_HTTP_RPC_URL,
    "BASE_MAINNET_HTTP_RPC_URL",
    problems
  );
  const baseMainnetWsRpcUrl = requireText(
    env.BASE_MAINNET_WS_RPC_URL,
    "BASE_MAINNET_WS_RPC_URL",
    problems
  );
  const chickenContractAddress = requireAddress(
    env.CHICKEN_CONTRACT_ADDRESS,
    "CHICKEN_CONTRACT_ADDRESS",
    problems
  );
  const veydriftRpcUrl = requireText(env.VEYDRIFT_RPC_URL, "VEYDRIFT_RPC_URL", problems);
  const veydriftMoonSystemAddress = requireAddress(
    env.VEYDRIFT_MOON_SYSTEM_ADDRESS,
    "VEYDRIFT_MOON_SYSTEM_ADDRESS",
    problems
  );
  const veydriftGrantPrivateKey = requirePrivateKey(
    env.VEYDRIFT_GRANT_PRIVATE_KEY,
    "VEYDRIFT_GRANT_PRIVATE_KEY",
    problems
  );

  const chickenBurnStartBlock = parseBigInt(
    env.CHICKEN_BURN_START_BLOCK,
    0n,
    "CHICKEN_BURN_START_BLOCK",
    problems
  );
  const backfillBlocks = parseBigInt(
    env.BACKFILL_BLOCKS,
    defaultBackfillBlocks,
    "BACKFILL_BLOCKS",
    problems
  );
  const maxRangeBlocks = parseBigInt(
    env.MAX_RANGE_BLOCKS,
    defaultMaxRangeBlocks,
    "MAX_RANGE_BLOCKS",
    problems
  );
  const veydriftChainId = parsePositiveInt(
    env.VEYDRIFT_CHAIN_ID,
    defaultVeydriftChainId,
    "VEYDRIFT_CHAIN_ID",
    problems
  );
  const backfillIntervalMs = parsePositiveInt(
    env.BACKFILL_INTERVAL_MS,
    defaultBackfillIntervalMs,
    "BACKFILL_INTERVAL_MS",
    problems
  );
  const port = parsePositiveInt(env.PORT, defaultPort, "PORT", problems);
  const chickenBurnEventSignature =
    env.CHICKEN_BURN_EVENT_SIGNATURE?.trim() || defaultChickenBurnEventSignature;
  const stateFile = env.STATE_FILE?.trim() || defaultStateFile;

  if (problems.length > 0) {
    return { config: null, problems };
  }

  return {
    config: {
      baseMainnetHttpRpcUrl,
      baseMainnetWsRpcUrl,
      chickenContractAddress,
      chickenBurnEventSignature,
      chickenBurnStartBlock,
      veydriftRpcUrl,
      veydriftMoonSystemAddress,
      veydriftGrantPrivateKey,
      veydriftChainId,
      stateFile,
      backfillIntervalMs,
      backfillBlocks,
      maxRangeBlocks,
      port
    },
    problems: []
  };
}

export function safeConfigSummary(config: ChickenBurnListenerConfig): Record<string, unknown> {
  return {
    baseMainnetHttpRpcUrl: redactUrl(config.baseMainnetHttpRpcUrl),
    baseMainnetWsRpcUrl: redactUrl(config.baseMainnetWsRpcUrl),
    chickenContractAddress: config.chickenContractAddress,
    chickenBurnEventSignature: config.chickenBurnEventSignature,
    chickenBurnStartBlock: config.chickenBurnStartBlock.toString(),
    veydriftRpcUrl: redactUrl(config.veydriftRpcUrl),
    veydriftMoonSystemAddress: config.veydriftMoonSystemAddress,
    veydriftGrantPrivateKey: "[redacted]",
    veydriftChainId: config.veydriftChainId,
    stateFile: config.stateFile,
    backfillIntervalMs: config.backfillIntervalMs,
    backfillBlocks: config.backfillBlocks.toString(),
    maxRangeBlocks: config.maxRangeBlocks.toString(),
    port: config.port
  };
}

function requireText(
  raw: string | undefined,
  field: string,
  problems: ConfigProblem[]
): string {
  const value = raw?.trim() ?? "";
  if (!value) {
    problems.push({ field, message: `${field} is required.` });
  }
  return value;
}

function requireAddress(
  raw: string | undefined,
  field: string,
  problems: ConfigProblem[]
): `0x${string}` {
  const value = raw?.trim() ?? "";
  if (!addressPattern.test(value)) {
    problems.push({ field, message: `${field} must be a 0x-prefixed 20-byte address.` });
  }
  return value as `0x${string}`;
}

function requirePrivateKey(
  raw: string | undefined,
  field: string,
  problems: ConfigProblem[]
): `0x${string}` {
  const value = raw?.trim() ?? "";
  if (!privateKeyPattern.test(value)) {
    problems.push({ field, message: `${field} must be a 0x-prefixed 32-byte hex private key.` });
  }
  return value as `0x${string}`;
}

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

function parseBigInt(
  raw: string | undefined,
  fallback: bigint,
  field: string,
  problems: ConfigProblem[]
): bigint {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  try {
    const value = BigInt(raw);
    if (value < 0n) {
      throw new Error("negative");
    }
    return value;
  } catch {
    problems.push({ field, message: `${field} must be a non-negative integer; got "${raw}".` });
    return fallback;
  }
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    for (const key of url.searchParams.keys()) {
      url.searchParams.set(key, "[redacted]");
    }
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      url.pathname = `/${pathParts.map((part, index) => (index === pathParts.length - 1 ? "[redacted]" : part)).join("/")}`;
    }
    return url.toString();
  } catch {
    return "[redacted-url]";
  }
}
