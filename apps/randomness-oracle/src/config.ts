// Configuration for the Veydrift randomness oracle.
//
// The oracle watches the RandomnessEngine for unfulfilled requests (created when
// players launch attacks) and posts a random word for each so combat resolution
// can proceed. It is intentionally stateless: every tick re-derives the pending
// set from on-chain state, so a restart never loses or double-fulfills work.

export type OracleConfig = {
  rpcUrl: string;
  chainId: number;
  randomnessEngineAddress: `0x${string}`;
  fulfillerPrivateKey: `0x${string}`;
  pollIntervalMs: number;
  port: number;
  // Lowest request id the oracle will consider. Requests below this are assumed
  // already handled (or intentionally abandoned) and are never scanned.
  startRequestId: bigint;
  // Hard cap on how many requests a single tick will fulfill, to bound gas/time.
  maxFulfillmentsPerTick: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required env var ${name}`);
  }
  return value.trim();
}

function optionalNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Env var ${name} must be a positive number, got ${raw}`);
  }
  return parsed;
}

function normalizeHex(value: string, name: string): `0x${string}` {
  const trimmed = value.trim();
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]+$/.test(prefixed)) {
    throw new Error(`Env var ${name} must be hex, got ${value}`);
  }
  return prefixed as `0x${string}`;
}

function resolveRpcUrl(env: NodeJS.ProcessEnv): string {
  const explicit =
    env.VEYDRIFT_RPC_URL ?? env.BASE_SEPOLIA_RPC_URL ?? env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
  if (explicit && explicit.trim() !== "") return explicit.trim();
  const apiKey = env.ALCHEMY_BASE_SEPOLIA_API_KEY;
  if (apiKey && apiKey.trim() !== "") {
    return `https://base-sepolia.g.alchemy.com/v2/${apiKey.trim()}`;
  }
  throw new Error(
    "Missing RPC config: set VEYDRIFT_RPC_URL (or BASE_SEPOLIA_RPC_URL / ALCHEMY_BASE_SEPOLIA_API_KEY)"
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OracleConfig {
  const fulfillerPrivateKey = normalizeHex(
    required(env, "VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY"),
    "VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY"
  );
  if (fulfillerPrivateKey.length !== 66) {
    throw new Error("VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY must be a 32-byte hex key");
  }

  return {
    rpcUrl: resolveRpcUrl(env),
    chainId: optionalNumber(env, "VEYDRIFT_CHAIN_ID", 84532),
    randomnessEngineAddress: normalizeHex(
      required(env, "VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS"),
      "VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS"
    ),
    fulfillerPrivateKey,
    pollIntervalMs: optionalNumber(env, "VEYDRIFT_RANDOMNESS_POLL_INTERVAL_MS", 5000),
    port: optionalNumber(env, "PORT", 4100),
    startRequestId: BigInt(env.VEYDRIFT_RANDOMNESS_START_REQUEST_ID?.trim() || "1"),
    maxFulfillmentsPerTick: optionalNumber(env, "VEYDRIFT_RANDOMNESS_MAX_PER_TICK", 25)
  };
}
