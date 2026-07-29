export type DeploymentMode = "local" | "test" | "staging" | "production";

export type BackendConfig = {
  allianceContractAddress?: `0x${string}`;
  chainId: number;
  deploymentMode: DeploymentMode;
  gameContractAddress?: `0x${string}`;
  migrationContractAddress?: `0x${string}`;
  indexDbPath: string;
  indexFromBlock: bigint;
  currentStateHealRunId?: string;
  resourceStateHealRunId?: string;
  currentStateHealConcurrency?: number;
  // Deprecated safety valve. Runtime canonical fleet-mission sync is disabled by default and must not be
  // scheduled by the backend; missions are mutated from indexed event logs after the one-time heal.
  fleetMissionSyncIntervalMs?: number;
  logChunkSpan?: bigint;
  // VEY-KANEO-485: hard deadline (ms) for the chain-read phase of a full cold rebuild. If the
  // deploy->head backfill does not finish in this window the rebuild rejects with a real error
  // (recorded as lastReconciliationError) instead of sitting in reconciliation_in_progress forever.
  // loadBackendConfig always populates it (default 5 min); optional only so existing BackendConfig
  // literals/fixtures that predate this field keep type-checking.
  rebuildDeadlineMs?: number;
  // Chain-sync HTTP poll cadence (ms). The indexer mutates ONLY from polled contract logs — no
  // websocket subscription, no self-heal/reconcile sweep. Each poll resolves head (eth_blockNumber)
  // and ingests the new block range; the contract's events carry absolute post-state
  // (PlanetShipCountChanged/PlanetDefenseCountChanged emit the resulting total) so re-scanning an
  // overlapping range is idempotent. Optional only so pre-existing BackendConfig literals/fixtures keep
  // type-checking; loadBackendConfig always populates the default.
  pollIntervalMs?: number;
  missionResolutionEnabled: boolean;
  missionResolverAddress?: `0x${string}`;
  missionResolverPrivateKey?: `0x${string}`;
  // VEY-KANEO-471: QA staging flag. When VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS is truthy AND the
  // deployment is NOT production, the fleet-visibility read model injects one synthetic incoming
  // attack with a populated `stationedDefenders` payload so the Mission Control "Stationed defenses"
  // panel can be visually verified without staging a real ≥2-wallet ACS Defend scenario on-chain.
  // Hard-forced false in production (see loadBackendConfig) so synthetic data is never prod-reachable.
  qaSyntheticStationedDefenders: boolean;
  moonContractAddress?: `0x${string}`;
  randomnessEngineAddress?: `0x${string}`;
  randomnessFulfillerPrivateKey?: `0x${string}`;
  randomnessCommitmentStorePath: string;
  randomnessCommitmentLegacyStorePath?: string;
  // Referral contracts can be replaced after the database-wide index cursor has advanced. This
  // independent boundary lets startup reconcile the configured referral contract's canonical event
  // history without replaying or wiping unrelated game/alliance state.
  referralIndexFromBlock?: bigint;
  referralSystemAddress?: `0x${string}`;
  referralSignerPrivateKey?: `0x${string}`;
  resourceTokenAddresses: ResourceTokenAddresses;
  rpcUrl?: string;
  rpcFallbackUrls?: string[];
  rpcSource: "alchemy-key" | "alchemy-url" | "custom-url" | "missing";
  // Cold-start metadata for the indexed settlement-price projection. HTTP request
  // paths never read RPC; StartPriceUpdated events and explicit rebuild reads become
  // canonical and divergence from this bootstrap value is surfaced by the indexer.
  settlementStartPriceWei?: string;
  settlementContractAddress?: `0x${string}`;
  wsRpcUrl?: string;
  wsRpcSource: "alchemy-key" | "alchemy-url" | "custom-url" | "missing";
};

export type ResourceTokenAddresses = {
  crystal?: `0x${string}`;
  deuterium?: `0x${string}`;
  metal?: `0x${string}`;
};

export type ConfigProblem = {
  field: string;
  message: string;
};

export type ConfigResult = {
  config: BackendConfig;
  problems: ConfigProblem[];
};

export type SafeConfigSummary = {
  allianceContractConfigured: boolean;
  chainId: number;
  deploymentMode: DeploymentMode;
  gameContractConfigured: boolean;
  hasRpcUrl: boolean;
  moonContractConfigured: boolean;
  migrationContractConfigured: boolean;
  missionResolutionEnabled: boolean;
  missionResolverConfigured: boolean;
  randomnessEngineConfigured: boolean;
  randomnessCommitterConfigured: boolean;
  referralSignerConfigured: boolean;
  referralIndexFromBlock: string;
  resourceTokensConfigured: {
    crystal: boolean;
    deuterium: boolean;
    metal: boolean;
  };
  rpcSource: BackendConfig["rpcSource"];
  rpcFallbackConfigured: boolean;
  rpcFallbackCount: number;
  wsRpcSource: BackendConfig["wsRpcSource"];
  hasWsRpcUrl: boolean;
  resourceTokenAddressesConfigured: boolean;
  settlementContractConfigured: boolean;
  settlementStartPriceConfigured: boolean;
  indexFromBlock: string;
  logChunkSpan: string;
  qaSyntheticStationedDefenders: boolean;
};

const defaultChainId = 84532;
const defaultDeploymentMode: DeploymentMode = "local";
const defaultIndexDbPath = ".data/contract-state.sqlite";
const defaultRandomnessCommitmentStorePath = ".data/randomness-commitments.json";
// VEY-KANEO-485: the self-hosted Base Sepolia node (now the ONLY RPC — Alchemy is permanently dead)
// caps eth_getLogs at a 100,000-block range. The old 2,000-block default needed ~180 sequential
// getLogs per event type to page the ~360k-block deploy->head history, so the cold wipe->reindex
// rebuild stalled for many minutes and never reached recordSuccessfulReconciliation. A 90,000-block
// span stays safely under the node's 100k cap (and well within response-size limits — the contract
// emits only ~36k logs total) while paging deploy->head in ~4 requests per event type. Operators can
// still tune VEYDRIFT_LOG_CHUNK_SPAN per node; getLogsRange keeps halving any chunk whose response a
// node still rejects/truncates, so this default is safe even if a future node caps lower.
const defaultLogChunkSpan = 90_000n;
// 30 minutes. The canonical-mirror cold reindex now reads the FULL current state of every entity from
// the contracts at boot — per-planet infrastructure/defense/shipyard/queues, per-owner research/moon,
// and all alliance state (members, join-requests, invites probed over candidate wallets x alliances, and
// diplomacy over alliance pairs) — on top of the deploy->head getLogs pages. On the single self-hosted
// Base node that whole sweep runs well past the old 5-minute ceiling, so a too-tight deadline aborted the
// seed every boot and it never committed. Keep it bounded (so a genuine hang still surfaces a real error
// and the boot-time recovery retries) but generous enough for the full contract-read seed to finish.
const defaultRebuildDeadlineMs = 1_800_000;
// Chain-sync HTTP poll cadence. Each tick resolves head (eth_blockNumber) and ingests the new block
// range through the indexer. 1s keeps post-transaction UI latency low while staying cheap on the
// single self-hosted node — an empty range is one small eth_getLogs over the latest block window.
// Operators can tune it via VEYDRIFT_POLL_INTERVAL_MS.
const defaultPollIntervalMs = 1_000;
const defaultCurrentStateHealConcurrency = 25;
const defaultFleetMissionSyncIntervalMs = 0;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const privateKeyPattern = /^0x[a-fA-F0-9]{64}$/;
const deploymentModes = new Set<DeploymentMode>(["local", "test", "staging", "production"]);

export function loadBackendConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  const problems: ConfigProblem[] = [];
  const deploymentMode = parseDeploymentMode(env.VEYDRIFT_DEPLOYMENT_MODE, problems);
  // VEY-KANEO-471: gate the synthetic stationed-defense QA payload on an explicit opt-in env AND a
  // non-production deployment. Both conditions are required, so a stray env in prod can never surface
  // fake defenders to real players.
  const qaSyntheticStationedDefenders =
    parseBooleanFlag(env.VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS) && deploymentMode !== "production";
  const chainId = parsePositiveInteger(env.VEYDRIFT_CHAIN_ID, "VEYDRIFT_CHAIN_ID", problems) ?? defaultChainId;
  const indexFromBlock = parseBigInt(env.VEYDRIFT_INDEX_FROM_BLOCK, "VEYDRIFT_INDEX_FROM_BLOCK", problems) ?? 0n;
  const referralIndexFromBlock = parseBigInt(
    env.VEYDRIFT_REFERRAL_INDEX_FROM_BLOCK,
    "VEYDRIFT_REFERRAL_INDEX_FROM_BLOCK",
    problems
  ) ?? indexFromBlock;
  const parsedLogChunkSpan = parseBigInt(env.VEYDRIFT_LOG_CHUNK_SPAN, "VEYDRIFT_LOG_CHUNK_SPAN", problems);
  const logChunkSpan = parsedLogChunkSpan && parsedLogChunkSpan > 0n ? parsedLogChunkSpan : defaultLogChunkSpan;
  const settlementStartPriceWei = parseBigInt(
    env.VEYDRIFT_SETTLEMENT_START_PRICE_WEI,
    "VEYDRIFT_SETTLEMENT_START_PRICE_WEI",
    problems
  );
  const rebuildDeadlineMs =
    parsePositiveInteger(env.VEYDRIFT_REBUILD_DEADLINE_MS, "VEYDRIFT_REBUILD_DEADLINE_MS", problems)
      ?? defaultRebuildDeadlineMs;
  const pollIntervalMs =
    parsePositiveInteger(env.VEYDRIFT_POLL_INTERVAL_MS, "VEYDRIFT_POLL_INTERVAL_MS", problems)
      ?? defaultPollIntervalMs;
  const currentStateHealConcurrency =
    parsePositiveInteger(env.VEYDRIFT_CURRENT_STATE_HEAL_CONCURRENCY, "VEYDRIFT_CURRENT_STATE_HEAL_CONCURRENCY", problems)
      ?? defaultCurrentStateHealConcurrency;
  const fleetMissionSyncIntervalMs =
    parseNonNegativeInteger(env.VEYDRIFT_FLEET_MISSION_SYNC_INTERVAL_MS, "VEYDRIFT_FLEET_MISSION_SYNC_INTERVAL_MS", problems)
      ?? defaultFleetMissionSyncIntervalMs;
  const currentStateHealRunId = normalizeRunId(env.VEYDRIFT_CURRENT_STATE_HEAL_RUN_ID);
  const resourceStateHealRunId = normalizeRunId(env.VEYDRIFT_RESOURCE_STATE_HEAL_RUN_ID);
  const { rpcUrl, rpcFallbackUrls, rpcSource } = resolveRpcUrl(env);
  const { wsRpcUrl, wsRpcSource } = resolveWsRpcUrl(env);
  const gameContractAddress = parseAddress(
    env.VEYDRIFT_GAME_CONTRACT_ADDRESS ?? env.VEYDRIFT_CONTRACT_ADDRESS,
    env.VEYDRIFT_GAME_CONTRACT_ADDRESS ? "VEYDRIFT_GAME_CONTRACT_ADDRESS" : "VEYDRIFT_CONTRACT_ADDRESS",
    problems
  );
  const allianceContractAddress = parseAddress(
    env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS,
    "VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS",
    problems
  );
  const settlementContractAddress = parseAddress(
    env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS,
    "VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS",
    problems
  );
  const migrationContractAddress = parseAddress(
    env.VEYDRIFT_MIGRATION_CONTRACT_ADDRESS,
    "VEYDRIFT_MIGRATION_CONTRACT_ADDRESS",
    problems
  );
  const moonContractAddress = parseAddress(
    env.VEYDRIFT_MOON_CONTRACT_ADDRESS,
    "VEYDRIFT_MOON_CONTRACT_ADDRESS",
    problems
  );
  const randomnessEngineAddress = parseAddress(
    env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS,
    "VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS",
    problems
  );
  const missionResolverAddress = parseAddress(
    env.VEYDRIFT_MISSION_RESOLVER_ADDRESS,
    "VEYDRIFT_MISSION_RESOLVER_ADDRESS",
    problems
  );
  const missionResolverPrivateKey = parsePrivateKey(
    env.VEYDRIFT_MISSION_RESOLVER_PRIVATE_KEY,
    "VEYDRIFT_MISSION_RESOLVER_PRIVATE_KEY",
    problems
  );
  const randomnessFulfillerPrivateKeyEnv =
    env.VEYDRIFT_RANDOMNESS_FULFILLER_KEY ?? env.VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY;
  const randomnessFulfillerPrivateKey = parsePrivateKey(
    randomnessFulfillerPrivateKeyEnv,
    env.VEYDRIFT_RANDOMNESS_FULFILLER_KEY
      ? "VEYDRIFT_RANDOMNESS_FULFILLER_KEY"
      : "VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY",
    problems
  );
  const randomnessCommitmentStorePath =
    env.VEYDRIFT_RANDOMNESS_COMMITMENT_STORE_PATH ?? defaultRandomnessCommitmentStorePath;
  const randomnessCommitmentLegacyStorePath = env.VEYDRIFT_RANDOMNESS_COMMITMENT_LEGACY_STORE_PATH;
  const referralSignerPrivateKey = parsePrivateKey(
    env.VEYDRIFT_REFERRAL_SIGNER_PRIVATE_KEY,
    "VEYDRIFT_REFERRAL_SIGNER_PRIVATE_KEY",
    problems
  );
  const referralSystemAddress = parseAddress(
    env.VEYDRIFT_REFERRAL_SYSTEM_ADDRESS,
    "VEYDRIFT_REFERRAL_SYSTEM_ADDRESS",
    problems
  );
  const metalTokenAddress = parseAddress(env.VEYDRIFT_METAL_TOKEN_ADDRESS, "VEYDRIFT_METAL_TOKEN_ADDRESS", problems);
  const crystalTokenAddress = parseAddress(
    env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS,
    "VEYDRIFT_CRYSTAL_TOKEN_ADDRESS",
    problems
  );
  const deuteriumTokenAddress = parseAddress(
    env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS,
    "VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS",
    problems
  );
  const resourceTokenAddresses = {
    ...(metalTokenAddress ? { metal: metalTokenAddress } : {}),
    ...(crystalTokenAddress ? { crystal: crystalTokenAddress } : {}),
    ...(deuteriumTokenAddress ? { deuterium: deuteriumTokenAddress } : {})
  };

  if (!rpcUrl) {
    problems.push({
      field: "RPC_URL",
      message:
        "Set VEYDRIFT_RPC_URL, BASE_SEPOLIA_RPC_URL, ALCHEMY_BASE_SEPOLIA_RPC_URL, or ALCHEMY_BASE_SEPOLIA_API_KEY."
    });
  }

  if (!gameContractAddress) {
    problems.push({
      field: "VEYDRIFT_GAME_CONTRACT_ADDRESS",
      message: "Set the deployed VeydriftGame proxy address."
    });
  }

  if (env.VEYDRIFT_REFERRAL_SIGNER_PRIVATE_KEY || env.VEYDRIFT_REFERRAL_SYSTEM_ADDRESS) {
    if (!referralSignerPrivateKey) {
      problems.push({
        field: "VEYDRIFT_REFERRAL_SIGNER_PRIVATE_KEY",
        message: "Referral configuration requires the backend redemption signer key."
      });
    }
    if (!referralSystemAddress) {
      problems.push({
        field: "VEYDRIFT_REFERRAL_SYSTEM_ADDRESS",
        message: "Referral configuration requires the deployed referral system address."
      });
    }
    if (settlementStartPriceWei === undefined) {
      problems.push({
        field: "VEYDRIFT_SETTLEMENT_START_PRICE_WEI",
        message: "Referral configuration requires a bootstrap game startPrice; indexed chain truth supersedes it."
      });
    }
  }

  return {
    config: {
      ...(allianceContractAddress ? { allianceContractAddress } : {}),
      chainId,
      deploymentMode,
      ...(gameContractAddress ? { gameContractAddress } : {}),
      indexDbPath: env.VEYDRIFT_INDEX_DB_PATH ?? defaultIndexDbPath,
      indexFromBlock,
      ...(currentStateHealRunId ? { currentStateHealRunId } : {}),
      ...(resourceStateHealRunId ? { resourceStateHealRunId } : {}),
      currentStateHealConcurrency,
      fleetMissionSyncIntervalMs,
      logChunkSpan,
      rebuildDeadlineMs,
      pollIntervalMs,
      missionResolutionEnabled: Boolean(missionResolverAddress || missionResolverPrivateKey),
      ...(missionResolverAddress ? { missionResolverAddress } : {}),
      ...(missionResolverPrivateKey ? { missionResolverPrivateKey } : {}),
      ...(migrationContractAddress ? { migrationContractAddress } : {}),
      qaSyntheticStationedDefenders,
      ...(moonContractAddress ? { moonContractAddress } : {}),
      ...(randomnessEngineAddress ? { randomnessEngineAddress } : {}),
      ...(randomnessFulfillerPrivateKey ? { randomnessFulfillerPrivateKey } : {}),
      randomnessCommitmentStorePath,
      ...(randomnessCommitmentLegacyStorePath ? { randomnessCommitmentLegacyStorePath } : {}),
      referralIndexFromBlock,
      ...(referralSystemAddress ? { referralSystemAddress } : {}),
      ...(referralSignerPrivateKey ? { referralSignerPrivateKey } : {}),
      resourceTokenAddresses,
      rpcSource,
      ...(rpcUrl ? { rpcUrl } : {}),
      ...(rpcFallbackUrls?.length ? { rpcFallbackUrls } : {}),
      ...(settlementStartPriceWei !== undefined ? { settlementStartPriceWei: settlementStartPriceWei.toString() } : {}),
      ...(settlementContractAddress ? { settlementContractAddress } : {}),
      wsRpcSource,
      ...(wsRpcUrl ? { wsRpcUrl } : {})
    },
    problems
  };
}

export function safeConfigSummary(config: BackendConfig): SafeConfigSummary {
  return {
    allianceContractConfigured: Boolean(config.allianceContractAddress),
    chainId: config.chainId,
    deploymentMode: config.deploymentMode,
    gameContractConfigured: Boolean(config.gameContractAddress),
    hasRpcUrl: Boolean(config.rpcUrl),
    moonContractConfigured: Boolean(config.moonContractAddress),
    migrationContractConfigured: Boolean(config.migrationContractAddress),
    missionResolutionEnabled: config.missionResolutionEnabled,
    missionResolverConfigured: Boolean(config.missionResolverAddress || config.missionResolverPrivateKey),
    randomnessEngineConfigured: Boolean(config.randomnessEngineAddress),
    randomnessCommitterConfigured: Boolean(
      config.randomnessEngineAddress && config.randomnessFulfillerPrivateKey && config.rpcUrl
    ),
    referralSignerConfigured: Boolean(config.referralSignerPrivateKey),
    referralIndexFromBlock: (config.referralIndexFromBlock ?? config.indexFromBlock).toString(),
    resourceTokensConfigured: {
      crystal: Boolean(config.resourceTokenAddresses.crystal),
      deuterium: Boolean(config.resourceTokenAddresses.deuterium),
      metal: Boolean(config.resourceTokenAddresses.metal)
    },
    rpcSource: config.rpcSource,
    rpcFallbackConfigured: Boolean(config.rpcFallbackUrls?.length),
    rpcFallbackCount: config.rpcFallbackUrls?.length ?? 0,
    wsRpcSource: config.wsRpcSource,
    hasWsRpcUrl: Boolean(config.wsRpcUrl),
    resourceTokenAddressesConfigured: Boolean(
      config.resourceTokenAddresses?.metal
        && config.resourceTokenAddresses.crystal
        && config.resourceTokenAddresses.deuterium
    ),
    settlementContractConfigured: Boolean(config.settlementContractAddress),
    settlementStartPriceConfigured: config.settlementStartPriceWei !== undefined,
    indexFromBlock: config.indexFromBlock.toString(),
    logChunkSpan: (config.logChunkSpan ?? defaultLogChunkSpan).toString(),
    // VEY-KANEO-471: surfaced on /health so QA can confirm the harness is active on a test deploy and
    // ops can confirm it is OFF everywhere it must be (always false in production).
    qaSyntheticStationedDefenders: config.qaSyntheticStationedDefenders
  };
}

export function requireConfigured(result: ConfigResult): BackendConfig {
  if (result.problems.length > 0) {
    throw new Error(result.problems.map((problem) => `${problem.field}: ${problem.message}`).join("; "));
  }

  return result.config;
}

function parseDeploymentMode(value: string | undefined, problems: ConfigProblem[]): DeploymentMode {
  if (!value) {
    return defaultDeploymentMode;
  }

  if (deploymentModes.has(value as DeploymentMode)) {
    return value as DeploymentMode;
  }

  problems.push({
    field: "VEYDRIFT_DEPLOYMENT_MODE",
    message: "Expected one of local, test, staging, production."
  });
  return defaultDeploymentMode;
}

function normalizeRunId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 128) : undefined;
}

// VEY-KANEO-471: lenient truthy parse for opt-in QA env flags ("1"/"true"/"yes"/"on", any case).
// Anything else — including unset — is false, so the flag defaults to OFF.
function parseBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(
  value: string | undefined,
  field: string,
  problems: ConfigProblem[]
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== value) {
    problems.push({
      field,
      message: "Expected a positive safe integer."
    });
    return undefined;
  }

  return parsed;
}

function parseNonNegativeInteger(
  value: string | undefined,
  field: string,
  problems: ConfigProblem[]
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed.toString() !== value) {
    problems.push({
      field,
      message: "Expected a non-negative safe integer."
    });
    return undefined;
  }

  return parsed;
}

function parseBigInt(value: string | undefined, field: string, problems: ConfigProblem[]): bigint | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error("negative");
    }
    return parsed;
  } catch {
    problems.push({
      field,
      message: "Expected a non-negative integer."
    });
    return undefined;
  }
}

function parseAddress(
  value: string | undefined,
  field: string,
  problems: ConfigProblem[]
): `0x${string}` | undefined {
  if (!value) {
    return undefined;
  }

  if (!addressPattern.test(value)) {
    problems.push({
      field,
      message: "Expected a 0x-prefixed 20-byte EVM address."
    });
    return undefined;
  }

  return value as `0x${string}`;
}

function parsePrivateKey(
  value: string | undefined,
  field: string,
  problems: ConfigProblem[]
): `0x${string}` | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!privateKeyPattern.test(normalized)) {
    problems.push({
      field,
      message: "Expected a 0x-prefixed 32-byte hex private key."
    });
    return undefined;
  }

  return normalized as `0x${string}`;
}

function resolveRpcUrl(env: Record<string, string | undefined>): Pick<BackendConfig, "rpcUrl" | "rpcFallbackUrls" | "rpcSource"> {
  const fallbackUrls = splitUrlList(
    env.VEYDRIFT_RPC_FALLBACK_URLS
      ?? env.BASE_SEPOLIA_RPC_FALLBACK_URLS
      ?? env.ALCHEMY_BASE_SEPOLIA_RPC_FALLBACK_URLS
  );
  const withFallbacks = (
    rpcUrl: string,
    rpcSource: BackendConfig["rpcSource"]
  ): Pick<BackendConfig, "rpcUrl" | "rpcFallbackUrls" | "rpcSource"> => ({
    rpcUrl,
    rpcSource,
    ...(fallbackUrls.length ? { rpcFallbackUrls: uniqueUrls(fallbackUrls, rpcUrl) } : {})
  });

  if (env.VEYDRIFT_RPC_URL) {
    return withFallbacks(env.VEYDRIFT_RPC_URL, "custom-url");
  }

  if (env.BASE_SEPOLIA_RPC_URL) {
    return withFallbacks(env.BASE_SEPOLIA_RPC_URL, "custom-url");
  }

  if (env.ALCHEMY_BASE_SEPOLIA_RPC_URL) {
    return withFallbacks(env.ALCHEMY_BASE_SEPOLIA_RPC_URL, "alchemy-url");
  }

  if (env.ALCHEMY_BASE_SEPOLIA_API_KEY) {
    return withFallbacks(`https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_BASE_SEPOLIA_API_KEY}`, "alchemy-key");
  }

  return { rpcSource: "missing" };
}

function splitUrlList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function uniqueUrls(urls: string[], primaryUrl: string): string[] {
  const seen = new Set([primaryUrl]);
  const unique: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  return unique;
}

export function resolveWsRpcUrl(
  env: Record<string, string | undefined>
): Pick<BackendConfig, "wsRpcUrl" | "wsRpcSource"> {
  if (env.VEYDRIFT_WS_RPC_URL) {
    return { wsRpcUrl: env.VEYDRIFT_WS_RPC_URL, wsRpcSource: "custom-url" };
  }

  if (env.BASE_SEPOLIA_WS_RPC_URL) {
    return { wsRpcUrl: env.BASE_SEPOLIA_WS_RPC_URL, wsRpcSource: "custom-url" };
  }

  if (env.ALCHEMY_BASE_SEPOLIA_WS_RPC_URL) {
    return { wsRpcUrl: env.ALCHEMY_BASE_SEPOLIA_WS_RPC_URL, wsRpcSource: "alchemy-url" };
  }

  if (env.ALCHEMY_BASE_SEPOLIA_WS_URL) {
    return { wsRpcUrl: env.ALCHEMY_BASE_SEPOLIA_WS_URL, wsRpcSource: "alchemy-url" };
  }

  if (env.ALCHEMY_BASE_SEPOLIA_API_KEY) {
    return {
      wsRpcUrl: `wss://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_BASE_SEPOLIA_API_KEY}`,
      wsRpcSource: "alchemy-key"
    };
  }

  const alchemyHttpRpcUrl =
    env.ALCHEMY_BASE_SEPOLIA_RPC_URL
    ?? env.VEYDRIFT_RPC_URL
    ?? env.BASE_SEPOLIA_RPC_URL;
  const derivedAlchemyWsRpcUrl = alchemyWebsocketUrlFromHttp(alchemyHttpRpcUrl);
  if (derivedAlchemyWsRpcUrl) {
    return { wsRpcUrl: derivedAlchemyWsRpcUrl, wsRpcSource: "alchemy-url" };
  }

  return { wsRpcSource: "missing" };
}

function alchemyWebsocketUrlFromHttp(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".g.alchemy.com")) {
      return null;
    }

    url.protocol = "wss:";
    return url.toString();
  } catch {
    return null;
  }
}
